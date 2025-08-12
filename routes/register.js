const express = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs-extra');
const { pool } = require('../config/database');

const router = express.Router();

// QR 코드 저장 디렉토리 생성
const qrDir = path.join(__dirname, '../qrcodes');
fs.ensureDirSync(qrDir);

// 고객 할인카드 발급 페이지
router.get('/', async (req, res) => {
    try {
        // 여행사 목록 조회
        const [agencies] = await pool.execute(
            'SELECT id, name, agency_code FROM travel_agencies ORDER BY name'
        );

        res.render('register', {
            title: '괌세이브카드 발급',
            agencies: agencies,
            error: null,
            success: null
        });
    } catch (error) {
        console.error('여행사 목록 조회 오류:', error);
        res.render('register', {
            title: '괌세이브카드 발급',
            agencies: [],
            error: '시스템 오류가 발생했습니다.',
            success: null
        });
    }
});

// 카드 발급 처리
router.post('/', async (req, res) => {
    const { customer_name, agency_code } = req.body;

    try {
        // 입력 검증
        if (!customer_name || !agency_code) {
            const [agencies] = await pool.execute(
                'SELECT id, name, agency_code FROM travel_agencies ORDER BY name'
            );
            return res.render('register', {
                title: '괌세이브카드 발급',
                agencies: agencies,
                error: '고객명과 여행사를 모두 입력해주세요.',
                success: null
            });
        }

        // 여행사 확인
        const [agencyResult] = await pool.execute(
            'SELECT id, name FROM travel_agencies WHERE agency_code = ?',
            [agency_code]
        );

        if (agencyResult.length === 0) {
            const [agencies] = await pool.execute(
                'SELECT id, name, agency_code FROM travel_agencies ORDER BY name'
            );
            return res.render('register', {
                title: '괌세이브카드 발급',
                agencies: agencies,
                error: '유효하지 않은 여행사 코드입니다.',
                success: null
            });
        }

        const agency = agencyResult[0];
        const token = uuidv4();

        // QR 코드 생성
        const cardUrl = `${req.protocol}://${req.get('host')}/card?token=${token}`;
        const qrFileName = `${token}.png`;
        const qrFilePath = path.join(qrDir, qrFileName);

        await QRCode.toFile(qrFilePath, cardUrl, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        // 데이터베이스에 사용자 정보 저장
        await pool.execute(
            'INSERT INTO savecard_users (customer_name, agency_id, token, qr_image_path) VALUES (?, ?, ?, ?)',
            [customer_name, agency.id, token, `/qrcodes/${qrFileName}`]
        );

        // 성공 페이지로 리다이렉트
        res.redirect(`/register/success?token=${token}`);

    } catch (error) {
        console.error('카드 발급 오류:', error);
        const [agencies] = await pool.execute(
            'SELECT id, name, agency_code FROM travel_agencies ORDER BY name'
        );
        res.render('register', {
            title: '괌세이브카드 발급',
            agencies: agencies,
            error: '카드 발급 중 오류가 발생했습니다.',
            success: null
        });
    }
});

// 발급 성공 페이지
router.get('/success', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.redirect('/register');
    }

    try {
        // 사용자 정보 조회
        const [userResult] = await pool.execute(`
            SELECT u.customer_name, u.token, u.qr_image_path, a.name as agency_name
            FROM savecard_users u
            JOIN travel_agencies a ON u.agency_id = a.id
            WHERE u.token = ?
        `, [token]);

        if (userResult.length === 0) {
            return res.redirect('/register');
        }

        const user = userResult[0];
        const cardUrl = `${req.protocol}://${req.get('host')}/card?token=${token}`;

        res.render('register-success', {
            title: '괌세이브카드 발급 완료',
            user: user,
            cardUrl: cardUrl,
            qrImageUrl: user.qr_image_path
        });

    } catch (error) {
        console.error('발급 성공 페이지 오류:', error);
        res.redirect('/register');
    }
});

module.exports = router;
