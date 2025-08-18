const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

const router = express.Router();

// 관리자 인증 미들웨어
function requireAuth(req, res, next) {
    if (!req.session.adminId) {
        return res.redirect('/admin/login');
    }
    next();
}

// 관리자 로그인 페이지
router.get('/login', (req, res) => {
    if (req.session.adminId) {
        return res.redirect('/admin');
    }
    res.render('admin/login', {
        title: '관리자 로그인',
        error: null
    });
});

// 로그인 처리
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const adminResult = await pool.query(
            'SELECT id, username, password_hash FROM admins WHERE username = $1',
            [username]
        );
        const adminRows = adminResult.rows;

        if (adminRows.length === 0) {
            return res.render('admin/login', {
                title: '관리자 로그인',
                error: '아이디 또는 비밀번호가 잘못되었습니다.'
            });
        }

        const admin = adminRows[0];
        const isValidPassword = await bcrypt.compare(password, admin.password_hash);

        if (!isValidPassword) {
            return res.render('admin/login', {
                title: '관리자 로그인',
                error: '아이디 또는 비밀번호가 잘못되었습니다.'
            });
        }

        // 세션에 관리자 정보 저장
        req.session.adminId = admin.id;
        req.session.adminUsername = admin.username;

        // 마지막 로그인 시간 업데이트
        await pool.query(
            'UPDATE admins SET last_login = NOW() WHERE id = $1',
            [admin.id]
        );

        res.redirect('/admin');

    } catch (error) {
        console.error('로그인 오류:', error);
        res.render('admin/login', {
            title: '관리자 로그인',
            error: '로그인 중 오류가 발생했습니다.'
        });
    }
});

// 로그아웃
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// 관리자 대시보드
router.get('/', requireAuth, async (req, res) => {
    try {
        // 통계 데이터 조회
        const statsResult = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM agencies) as total_agencies,
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM usages) as total_usages,
                (SELECT COUNT(*) FROM banners WHERE is_active = true) as active_banners
        `);
        const stats = statsResult.rows[0];

        // 최근 사용 이력
        const recentUsagesResult = await pool.query(`
            SELECT u.store_name, u.used_at, us.name as customer_name, a.name as agency_name
            FROM usages u
            JOIN users us ON u.token = us.token
            JOIN agencies a ON us.agency_id = a.id
            ORDER BY u.used_at DESC
            LIMIT 10
        `);
        const recentUsages = recentUsagesResult.rows;

        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            stats: stats,
            recentUsages: recentUsages,
            adminUsername: req.session.adminUsername
        });

    } catch (error) {
        console.error('대시보드 오류:', error);
        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            stats: { total_agencies: 0, total_users: 0, total_usages: 0, active_banners: 0 },
            recentUsages: [],
            adminUsername: req.session.adminUsername
        });
    }
});

// 여행사 관리
router.get('/agencies', requireAuth, async (req, res) => {
    try {
        const agenciesResult = await pool.query(`
            SELECT a.*, 
                   COUNT(u.id) as user_count
            FROM agencies a
            LEFT JOIN users u ON a.id = u.agency_id
            GROUP BY a.id, a.name, a.code, a.display_order, a.sort_order, a.created_at, a.updated_at
            ORDER BY a.created_at DESC
        `);

        res.render('admin/agencies', {
            title: '여행사 관리',
            agencies: agenciesResult.rows,
            adminUsername: req.session.adminUsername,
            success: req.query.success,
            error: req.query.error
        });

    } catch (error) {
        console.error('여행사 목록 조회 오류:', error);
        res.render('admin/agencies', {
            title: '여행사 관리',
            agencies: [],
            adminUsername: req.session.adminUsername,
            success: null,
            error: '데이터를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

// 여행사 추가
router.post('/agencies', requireAuth, async (req, res) => {
    const { name, code, contact_email, contact_phone } = req.body;

    console.log('여행사 추가 요청:', { name, code, contact_email, contact_phone });

    try {
        // 데이터베이스 연결 상태 확인
        const testResult = await pool.query('SELECT 1 as test');
        console.log('DB 연결 테스트 성공:', testResult.rows);

        // 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'agencies'
            ORDER BY ordinal_position
        `);
        console.log('agencies 테이블 컬럼:', tableCheck.rows);

        const result = await pool.query(
            'INSERT INTO agencies (name, code, contact_email, contact_phone) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, code, contact_email || null, contact_phone || null]
        );

        console.log('여행사 추가 성공:', result.rows[0]);
        
        // AJAX 요청인지 확인
        if (req.headers['content-type'] === 'application/json') {
            res.json({
                success: true,
                message: '여행사가 성공적으로 추가되었습니다.',
                agency: result.rows[0]
            });
        } else {
            res.redirect('/admin/agencies?success=여행사가 성공적으로 추가되었습니다.');
        }

    } catch (error) {
        console.error('여행사 추가 상세 오류:');
        console.error('- 오류 코드:', error.code);
        console.error('- 오류 메시지:', error.message);
        console.error('- 전체 오류:', error);
        
        let errorMessage = '여행사 추가 중 오류가 발생했습니다.';
        if (error.code === '23505') {
            errorMessage = '이미 존재하는 여행사 코드입니다.';
        } else if (error.code === '42P01') {
            errorMessage = 'agencies 테이블이 존재하지 않습니다.';
        } else if (error.code === '42703') {
            errorMessage = '필요한 컬럼이 존재하지 않습니다.';
        }
        
        // AJAX 요청인지 확인
        if (req.headers['content-type'] === 'application/json') {
            res.status(400).json({
                success: false,
                message: errorMessage
            });
        } else {
            res.redirect(`/admin/agencies?error=${errorMessage}: ${error.message}`);
        }
    }
});

// 여행사 수정
router.put('/agencies/:id', requireAuth, async (req, res) => {
    const agencyId = req.params.id;
    const { name, code, contact_email, contact_phone } = req.body;

    console.log('여행사 수정 요청:', { agencyId, body: req.body });

    try {
        // 기존 여행사 정보 조회
        const existingResult = await pool.query('SELECT * FROM agencies WHERE id = $1', [agencyId]);
        
        if (existingResult.rows.length === 0) {
            return res.json({ success: false, message: '여행사를 찾을 수 없습니다.' });
        }

        const existing = existingResult.rows[0];

        // 업데이트할 데이터 준비 (전달된 필드만 업데이트)
        const updateData = {
            name: name !== undefined ? name : existing.name,
            code: code !== undefined ? code : existing.code,
            contact_email: contact_email !== undefined ? contact_email : existing.contact_email,
            contact_phone: contact_phone !== undefined ? contact_phone : existing.contact_phone
        };

        const result = await pool.query(`
            UPDATE agencies 
            SET name = $1, code = $2, contact_email = $3, contact_phone = $4, 
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5 
            RETURNING *
        `, [updateData.name, updateData.code, updateData.contact_email, updateData.contact_phone, agencyId]);

        console.log('여행사 수정 성공:', result.rows[0]);
        res.json({ success: true, message: '여행사 정보가 성공적으로 수정되었습니다.', agency: result.rows[0] });

    } catch (error) {
        console.error('여행사 수정 오류:', error);
        let errorMessage = '여행사 수정 중 오류가 발생했습니다.';
        if (error.code === '23505') {
            errorMessage = '이미 존재하는 여행사 코드입니다.';
        }
        res.json({ success: false, message: errorMessage });
    }
});

// 고객 관리
router.get('/users', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        // 전체 사용자 수 조회
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM users'
        );
        const totalUsers = countResult.rows[0].total;
        const totalPages = Math.ceil(totalUsers / limit);

        // 사용자 목록 조회
        const usersResult = await pool.query(`
            SELECT u.*, a.name as agency_name,
                   COUNT(cu.id) as usage_count
            FROM users u
            LEFT JOIN agencies a ON u.agency_id = a.id
            LEFT JOIN usages cu ON u.token = cu.token
            GROUP BY u.id, u.name, u.email, u.phone, u.agency_id, u.token, u.qr_code, u.expiration_start, u.expiration_end, u.pin, u.created_at, u.updated_at, a.name
            ORDER BY u.created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const users = usersResult.rows;

        res.render('admin/users', {
            title: '고객 관리',
            users: users,
            currentPage: page,
            totalPages: totalPages,
            adminUsername: req.session.adminUsername
        });

    } catch (error) {
        console.error('고객 목록 조회 오류:', error);
        res.render('admin/users', {
            title: '고객 관리',
            users: [],
            currentPage: 1,
            totalPages: 1,
            adminUsername: req.session.adminUsername
        });
    }
});

// 사용 이력 관리
router.get('/usages', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 50;
        const offset = (page - 1) * limit;

        // 전체 사용 이력 수 조회
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM usages'
        );
        const totalUsages = countResult.rows[0].total;
        const totalPages = Math.ceil(totalUsages / limit);

        // 사용 이력 조회
        const usagesResult = await pool.query(`
            SELECT u.*, us.name as customer_name, a.name as agency_name
            FROM usages u
            JOIN users us ON u.token = us.token
            JOIN agencies a ON us.agency_id = a.id
            ORDER BY u.used_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const usages = usagesResult.rows;

        res.render('admin/usages', {
            title: '사용 이력 관리',
            usages: usages,
            currentPage: page,
            totalPages: totalPages,
            adminUsername: req.session.adminUsername
        });

    } catch (error) {
        console.error('사용 이력 조회 오류:', error);
        res.render('admin/usages', {
            title: '사용 이력 관리',
            usages: [],
            currentPage: 1,
            totalPages: 1,
            adminUsername: req.session.adminUsername
        });
    }
});

// 광고 배너 관리
router.get('/banners', requireAuth, async (req, res) => {
    try {
        const bannersResult = await pool.query(`
            SELECT * FROM banners
            ORDER BY display_order ASC, created_at DESC
        `);
        const banners = bannersResult.rows;

        res.render('admin/banners', {
            title: '광고 배너 관리',
            banners: banners,
            adminUsername: req.session.adminUsername,
            success: req.query.success,
            error: req.query.error
        });

    } catch (error) {
        console.error('배너 목록 조회 오류:', error);
        res.render('admin/banners', {
            title: '광고 배너 관리',
            banners: [],
            adminUsername: req.session.adminUsername,
            success: null,
            error: '데이터를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

// 배너 추가
router.post('/banners', requireAuth, async (req, res) => {
    const { advertiser_name, image_url, link_url, display_order } = req.body;

    try {
        await pool.query(
            'INSERT INTO banners (advertiser_name, image_url, link_url, display_order) VALUES ($1, $2, $3, $4)',
            [advertiser_name, image_url, link_url || null, parseInt(display_order) || 0]
        );

        res.redirect('/admin/banners?success=광고 배너가 성공적으로 추가되었습니다.');

    } catch (error) {
        console.error('배너 추가 오류:', error);
        res.redirect('/admin/banners?error=배너 추가 중 오류가 발생했습니다.');
    }
});

// 배너 활성화/비활성화
router.post('/banners/:id/toggle', requireAuth, async (req, res) => {
    const bannerId = req.params.id;

    try {
        await pool.query(
            'UPDATE banners SET is_active = NOT is_active WHERE id = $1',
            [bannerId]
        );

        res.json({ success: true });

    } catch (error) {
        console.error('배너 상태 변경 오류:', error);
        res.json({ success: false, message: '상태 변경 중 오류가 발생했습니다.' });
    }
});

// 여행사 삭제
router.delete('/agencies/:id', requireAuth, async (req, res) => {
    const agencyId = req.params.id;

    try {
        // 먼저 해당 여행사에 연결된 사용자들 삭제
        await pool.query('DELETE FROM users WHERE agency_id = $1', [agencyId]);
        
        // 여행사 삭제
        const result = await pool.query('DELETE FROM agencies WHERE id = $1 RETURNING *', [agencyId]);
        
        if (result.rows.length === 0) {
            return res.json({ success: false, message: '삭제할 여행사를 찾을 수 없습니다.' });
        }

        res.json({ success: true, message: '여행사가 성공적으로 삭제되었습니다.' });

    } catch (error) {
        console.error('여행사 삭제 오류:', error);
        res.json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

// 배너 삭제
router.delete('/banners/:id', requireAuth, async (req, res) => {
    const bannerId = req.params.id;

    try {
        await pool.query('DELETE FROM banners WHERE id = $1', [bannerId]);
        res.json({ success: true });

    } catch (error) {
        console.error('배너 삭제 오류:', error);
        res.json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
