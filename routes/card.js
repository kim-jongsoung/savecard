const express = require('express');
const { pool } = require('../config/database');

const router = express.Router();

// 카드 접속 페이지
router.get('/', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.render('error', {
            title: '잘못된 접근',
            message: '유효하지 않은 카드입니다.',
            error: { status: 400 }
        });
    }

    try {
        // 사용자 정보 조회
        const [userResult] = await pool.execute(`
            SELECT u.id, u.customer_name, u.token, a.name as agency_name
            FROM savecard_users u
            JOIN travel_agencies a ON u.agency_id = a.id
            WHERE u.token = ?
        `, [token]);

        if (userResult.length === 0) {
            return res.render('error', {
                title: '카드를 찾을 수 없습니다',
                message: '유효하지 않은 카드입니다.',
                error: { status: 404 }
            });
        }

        const user = userResult[0];

        // 활성화된 광고 배너 조회 (랜덤)
        const [bannerResult] = await pool.execute(`
            SELECT id, advertiser_name, image_url, link_url
            FROM banners
            WHERE is_active = 1
            ORDER BY RAND()
            LIMIT 1
        `);

        const banner = bannerResult.length > 0 ? bannerResult[0] : null;

        // 사용 이력 조회 (최근 5개)
        const [usageResult] = await pool.execute(`
            SELECT store_code, used_at
            FROM card_usages
            WHERE token = ?
            ORDER BY used_at DESC
            LIMIT 5
        `, [token]);

        res.render('card', {
            title: '괌세이브카드',
            user: user,
            banner: banner,
            usages: usageResult,
            success: null,
            error: null
        });

    } catch (error) {
        console.error('카드 페이지 오류:', error);
        res.render('error', {
            title: '시스템 오류',
            message: '카드 정보를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

// 카드 사용 처리
router.post('/use', async (req, res) => {
    const { token, store_code } = req.body;

    if (!token || !store_code) {
        return res.json({
            success: false,
            message: '토큰과 제휴처명을 모두 입력해주세요.'
        });
    }

    try {
        // 사용자 토큰 확인
        const [userResult] = await pool.execute(
            'SELECT id FROM savecard_users WHERE token = ?',
            [token]
        );

        if (userResult.length === 0) {
            return res.json({
                success: false,
                message: '유효하지 않은 카드입니다.'
            });
        }

        // 사용 이력 저장
        const userAgent = req.get('User-Agent') || '';
        const ipAddress = req.ip || req.connection.remoteAddress || '';

        await pool.execute(`
            INSERT INTO card_usages (token, store_code, used_at, ip_address, user_agent)
            VALUES (?, ?, NOW(), ?, ?)
        `, [token, store_code.trim(), ipAddress, userAgent]);

        res.json({
            success: true,
            message: '할인 사용이 완료되었습니다!'
        });

    } catch (error) {
        console.error('카드 사용 처리 오류:', error);
        res.json({
            success: false,
            message: '사용 처리 중 오류가 발생했습니다.'
        });
    }
});

module.exports = router;
