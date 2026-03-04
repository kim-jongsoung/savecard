const mongoose = require('mongoose');

const reverseInvoiceSchema = new mongoose.Schema({
    date:           { type: Date,   required: true },
    supplier_name:  { type: String, required: true },
    total_amount:   { type: Number, default: 0 },
    supply_amount:  { type: Number, default: 0 },
    tax_amount:     { type: Number, default: 0 },
    notes:          { type: String, default: '' },
}, { _id: true });

const cardExpenseSchema = new mongoose.Schema({
    date:           { type: Date,   required: true },
    merchant:       { type: String, default: '' },
    amount:         { type: Number, default: 0 },
    supply_amount:  { type: Number, default: 0 },
    tax_amount:     { type: Number, default: 0 },
    category:       { type: String, default: '' },
    deductible:     { type: Boolean, default: true },
    card_number:    { type: String, default: '' },
    notes:          { type: String, default: '' },
}, { _id: true });

const vatReportSchema = new mongoose.Schema({
    year:   { type: Number, required: true },
    month:  { type: Number, required: true },
    half:   { type: Number, required: true },

    sales_base:     { type: Number, default: 0 },
    sales_tax:      { type: Number, default: 0 },

    bank_purchase_items: [{
        category:     { type: String },
        label:        { type: String },
        total_amount: { type: Number, default: 0 },
        tax_amount:   { type: Number, default: 0 },
        deductible:   { type: Boolean, default: false },
        count:        { type: Number, default: 0 },
    }],
    bank_deductible_tax:  { type: Number, default: 0 },

    card_expenses:        [cardExpenseSchema],
    card_deductible_tax:  { type: Number, default: 0 },

    reverse_invoices:     [reverseInvoiceSchema],
    reverse_tax_total:    { type: Number, default: 0 },

    total_purchase_tax:   { type: Number, default: 0 },
    tax_payable:          { type: Number, default: 0 },

    status: { type: String, enum: ['draft', 'confirmed', 'filed'], default: 'draft' },
    notes:     { type: String, default: '' },
    saved_by:  { type: String, default: '' },
}, { timestamps: true });

vatReportSchema.index({ year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('VatReport', vatReportSchema);
