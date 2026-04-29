const cds = require('@sap/cds');
const express = require('express');

// Patch body-parser limit TRƯỚC khi OData adapter set limit của nó
cds.on('bootstrap', (app) => {
    app.use(express.json({ limit: '20mb' }));
    app.use(express.text({ limit: '20mb', type: ['text/*', 'application/json'] }));
});

module.exports = cds.server;
