const express = require('express');
const router = express.Router();
const PackageBookingChannel = require('../models/PackageBookingChannel');
const PackageSupplier = require('../models/PackageSupplier');

// 인증 미들웨어
const requireAuth = (req, res, next) => {
    if (!req.session.adminId) {
        return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
    next();
};

// ============================================
// 예약채널 API
// ============================================

// 예약채널 목록 조회
router.get('/channels', requireAuth, async (req, res) => {
    try {
        const { active_only } = req.query;
        
        const query = active_only === 'true' ? { is_active: true } : {};
        
        const channels = await PackageBookingChannel.find(query)
            .sort({ channel_name: 1 })
            .lean();
        
        res.json({
            success: true,
            data: channels,
            count: channels.length
        });
        
    } catch (error) {
        console.error('❌ 예약채널 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '예약채널 목록 조회 중 오류가 발생했습니다.'
        });
    }
});

// 예약채널 등록
router.post('/channels', requireAuth, async (req, res) => {
    try {
        const { channel_name, contact_person, contact_email, contact_phone } = req.body;
        
        if (!channel_name) {
            return res.status(400).json({
                success: false,
                message: '예약채널명은 필수입니다.'
            });
        }
        
        // 중복 체크
        const existing = await PackageBookingChannel.findOne({ channel_name });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: '이미 등록된 예약채널입니다.'
            });
        }
        
        const channel = new PackageBookingChannel({
            channel_name,
            contact_person: contact_person || '',
            contact_email: contact_email || '',
            contact_phone: contact_phone || ''
        });
        
        await channel.save();
        
        res.json({
            success: true,
            message: '예약채널이 등록되었습니다.',
            data: channel
        });
        
    } catch (error) {
        console.error('❌ 예약채널 등록 실패:', error);
        res.status(500).json({
            success: false,
            message: '예약채널 등록 중 오류가 발생했습니다.'
        });
    }
});

// 예약채널 수정
router.put('/channels/:id', requireAuth, async (req, res) => {
    try {
        const { channel_name, contact_person, contact_email, contact_phone, is_active } = req.body;
        
        const channel = await PackageBookingChannel.findById(req.params.id);
        
        if (!channel) {
            return res.status(404).json({
                success: false,
                message: '예약채널을 찾을 수 없습니다.'
            });
        }
        
        // 채널명 변경 시 중복 체크
        if (channel_name && channel_name !== channel.channel_name) {
            const existing = await PackageBookingChannel.findOne({ channel_name });
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: '이미 등록된 예약채널명입니다.'
                });
            }
            channel.channel_name = channel_name;
        }
        
        if (contact_person !== undefined) channel.contact_person = contact_person;
        if (contact_email !== undefined) channel.contact_email = contact_email;
        if (contact_phone !== undefined) channel.contact_phone = contact_phone;
        if (is_active !== undefined) channel.is_active = is_active;
        
        await channel.save();
        
        res.json({
            success: true,
            message: '예약채널이 수정되었습니다.',
            data: channel
        });
        
    } catch (error) {
        console.error('❌ 예약채널 수정 실패:', error);
        res.status(500).json({
            success: false,
            message: '예약채널 수정 중 오류가 발생했습니다.'
        });
    }
});

// 예약채널 삭제
router.delete('/channels/:id', requireAuth, async (req, res) => {
    try {
        const channel = await PackageBookingChannel.findByIdAndDelete(req.params.id);
        
        if (!channel) {
            return res.status(404).json({
                success: false,
                message: '예약채널을 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '예약채널이 삭제되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 예약채널 삭제 실패:', error);
        res.status(500).json({
            success: false,
            message: '예약채널 삭제 중 오류가 발생했습니다.'
        });
    }
});

// ============================================
// 공급업체 API
// ============================================

// 공급업체 목록 조회
router.get('/suppliers', requireAuth, async (req, res) => {
    try {
        const { supplier_type, active_only } = req.query;
        
        const query = {};
        if (supplier_type) query.supplier_type = supplier_type;
        if (active_only === 'true') query.is_active = true;
        
        const suppliers = await PackageSupplier.find(query)
            .sort({ supplier_type: 1, supplier_name: 1 })
            .lean();
        
        res.json({
            success: true,
            data: suppliers,
            count: suppliers.length
        });
        
    } catch (error) {
        console.error('❌ 공급업체 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '공급업체 목록 조회 중 오류가 발생했습니다.'
        });
    }
});

// 공급업체 등록
router.post('/suppliers', requireAuth, async (req, res) => {
    try {
        const { supplier_type, supplier_name, contact_person, contact_email, contact_phone, notes } = req.body;
        
        if (!supplier_type || !supplier_name) {
            return res.status(400).json({
                success: false,
                message: '공급업체 유형과 업체명은 필수입니다.'
            });
        }
        
        const supplier = new PackageSupplier({
            supplier_type,
            supplier_name,
            contact_person: contact_person || '',
            contact_email: contact_email || '',
            contact_phone: contact_phone || '',
            notes: notes || ''
        });
        
        await supplier.save();
        
        res.json({
            success: true,
            message: '공급업체가 등록되었습니다.',
            data: supplier
        });
        
    } catch (error) {
        console.error('❌ 공급업체 등록 실패:', error);
        res.status(500).json({
            success: false,
            message: '공급업체 등록 중 오류가 발생했습니다.'
        });
    }
});

// 공급업체 수정
router.put('/suppliers/:id', requireAuth, async (req, res) => {
    try {
        const { supplier_type, supplier_name, contact_person, contact_email, contact_phone, notes, is_active } = req.body;
        
        const supplier = await PackageSupplier.findById(req.params.id);
        
        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: '공급업체를 찾을 수 없습니다.'
            });
        }
        
        if (supplier_type !== undefined) supplier.supplier_type = supplier_type;
        if (supplier_name !== undefined) supplier.supplier_name = supplier_name;
        if (contact_person !== undefined) supplier.contact_person = contact_person;
        if (contact_email !== undefined) supplier.contact_email = contact_email;
        if (contact_phone !== undefined) supplier.contact_phone = contact_phone;
        if (notes !== undefined) supplier.notes = notes;
        if (is_active !== undefined) supplier.is_active = is_active;
        
        await supplier.save();
        
        res.json({
            success: true,
            message: '공급업체가 수정되었습니다.',
            data: supplier
        });
        
    } catch (error) {
        console.error('❌ 공급업체 수정 실패:', error);
        res.status(500).json({
            success: false,
            message: '공급업체 수정 중 오류가 발생했습니다.'
        });
    }
});

// 공급업체 삭제
router.delete('/suppliers/:id', requireAuth, async (req, res) => {
    try {
        const supplier = await PackageSupplier.findByIdAndDelete(req.params.id);
        
        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: '공급업체를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '공급업체가 삭제되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 공급업체 삭제 실패:', error);
        res.status(500).json({
            success: false,
            message: '공급업체 삭제 중 오류가 발생했습니다.'
        });
    }
});

module.exports = router;
