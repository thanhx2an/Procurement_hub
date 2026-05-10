module.exports = (srv, { Shipments, AuditLogs, AssetAttachments }) => {

    // ─── ACTION: Upload PDF Invoice ───────────────────────────────────────
    srv.on('uploadInvoicePdf', async (req) => {
        const { shipmentId, content, fileName, fileSize, mimeType: fileMimeType } = req.data;
        const MIME_MAP = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
        const ext      = fileName?.split('.').pop().toLowerCase();
        const mimeType = fileMimeType || MIME_MAP[ext] || 'application/pdf';
        console.log('[UploadInvoice] Shipment:', shipmentId, '| File:', fileName, '| Type:', mimeType, '| User:', req.user?.id);

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const BUCKET       = process.env.SUPABASE_BUCKET || 'invoices';

        try {
            const filePath  = `shipments/${shipmentId}/${Date.now()}_${fileName}`;
            const pdfBuffer = Buffer.from(content, 'base64');

            const uploadRes = await fetch(
                `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`,
                {
                    method:  'POST',
                    headers: {
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type':  mimeType,
                        'x-upsert':      'true',
                    },
                    body: pdfBuffer,
                }
            );

            if (!uploadRes.ok) {
                const err = await uploadRes.text();
                throw new Error(`Supabase upload failed: ${uploadRes.status} ${err}`);
            }

            const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`;
            console.log('[UploadInvoice] Uploaded to:', storageUrl);

            let ocrResult = { trackingNumber: null, batchId: null, vendorName: null, totalAmount: null, confidence: 0, storageUrl };
            try {
                const GOOGLE_AI_KEY = process.env.GOOGLE_AI_KEY;
                if (!GOOGLE_AI_KEY) throw new Error('GOOGLE_AI_KEY not set');

                const aiRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GOOGLE_AI_KEY}`,
                    {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [
                                    {
                                        inline_data: {
                                            mime_type: mimeType,
                                            data: content,  // base64 string from req.data — sent directly to Gemini
                                        }
                                    },
                                    {
                                        text: `You are a document parser. Extract structured data from this delivery note / invoice and return ONLY valid JSON with these exact fields:
{
  "trackingNumber": "tracking/waybill/shipment number or null",
  "batchId": "batch/lot number or null",
  "vendorName": "vendor/supplier company name or null",
  "totalAmount": 0.00,
  "confidence": 0.0
}

The document may be in any language — always return field values in their original form (do not translate values).
Return ONLY the JSON object, no explanation.`,
                                    }
                                ],
                            }],
                            generationConfig: { responseMimeType: 'application/json' },
                        }),
                    }
                );

                if (aiRes.ok) {
                    const aiData = await aiRes.json();
                    const parsed = JSON.parse(aiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
                    ocrResult = {
                        trackingNumber: parsed.trackingNumber || null,
                        batchId:        parsed.batchId        || null,
                        vendorName:     parsed.vendorName     || null,
                        totalAmount:    parsed.totalAmount != null ? Number(parsed.totalAmount) : null,
                        confidence:     parsed.confidence     || 0.9,
                        storageUrl,
                    };
                    console.log('[UploadInvoice] AI extracted:', JSON.stringify(ocrResult));
                } else {
                    const errText = await aiRes.text();
                    console.warn('[UploadInvoice] Google AI error:', aiRes.status, errText);
                }
            } catch (ocrErr) {
                console.warn('[UploadInvoice] OCR failed (non-fatal):', ocrErr.message);
            }

            // Insert core attachment fields first (always safe)
            const attachmentEntry = {
                shipment_ID:  shipmentId,
                fileName,
                mimeType,
                storageUrl,
                fileSize:     fileSize || pdfBuffer.length,
                uploadedAt:   new Date().toISOString(),
                uploadedBy:   req.user?.id || 'anonymous',
            };
            // Attempt to include AI fields if schema supports them (requires deployed schema update)
            try {
                await INSERT.into(AssetAttachments).entries({
                    ...attachmentEntry,
                    batchId:      ocrResult.batchId,
                    vendorName:   ocrResult.vendorName,
                    totalAmount:  ocrResult.totalAmount,
                    aiConfidence: ocrResult.confidence,
                });
                console.log('[UploadInvoice] AssetAttachment inserted with AI fields');
            } catch (insertErr) {
                // AI columns may not exist in HANA yet — fall back to core fields only
                console.warn('[UploadInvoice] AI fields insert failed, retrying with core fields only:', insertErr.message);
                await INSERT.into(AssetAttachments).entries(attachmentEntry);
                console.log('[UploadInvoice] AssetAttachment inserted (core fields only — deploy schema to enable AI fields)');
            }

            if (ocrResult.trackingNumber) {
                await UPDATE(Shipments).set({ trackingNumber: ocrResult.trackingNumber }).where({ ID: shipmentId });
                console.log('[UploadInvoice] Saved trackingNumber to Shipment:', ocrResult.trackingNumber);
            }

            await INSERT.into(AuditLogs).entries({
                entityName: 'Shipments',
                entityId:   shipmentId,
                action:     'INVOICE_UPLOADED',
                changedBy:  req.user?.id || 'system',
                changedAt:  new Date().toISOString(),
                newValue:   JSON.stringify({ ...ocrResult, fileName }),
            });

            return ocrResult;
        } catch (err) {
            console.error('[UploadInvoice] Error:', err.message);
            throw err;
        }
    });

    // ─── BEFORE DELETE AssetAttachment: xóa file khỏi Supabase trước ─────
    srv.before('DELETE', 'AssetAttachments', async (req) => {
        const id = req.params?.[0]?.ID ?? req.params?.[0];
        if (!id) return;
        try {
            const attachment = await SELECT.one.from(AssetAttachments).where({ ID: id });
            if (!attachment?.storageUrl) return;

            const SUPABASE_URL = process.env.SUPABASE_URL;
            const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
            const BUCKET       = process.env.SUPABASE_BUCKET || 'invoices';

            const marker = `/storage/v1/object/public/${BUCKET}/`;
            const idx = attachment.storageUrl.indexOf(marker);
            if (idx === -1) return;
            const filePath = attachment.storageUrl.slice(idx + marker.length);

            const delRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
                method:  'DELETE',
                headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ prefixes: [filePath] }),
            });
            if (!delRes.ok) {
                console.error('[DeleteAttachment] Supabase error:', await delRes.text());
            } else {
                console.log('[DeleteAttachment] Deleted from Supabase:', filePath);
            }
        } catch (err) {
            console.error('[DeleteAttachment] Error:', err.message);
        }
    });

};
