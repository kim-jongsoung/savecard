const express = require('express');
const bcrypt = require('bcryptjs');

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
    console.log('로그인 요청 받음:', req.body);
    console.log('요청 헤더:', req.headers);
    
    const { username, password } = req.body;

    try {
        // 관리자 계정 목록
        const adminAccounts = [
            { username: process.env.ADMIN_USERNAME || 'luxfind01', password: process.env.ADMIN_PASSWORD || 'vasco01@' },
            { username: process.env.ADMIN_USERNAME2 || 'kmtour', password: process.env.ADMIN_PASSWORD2 || 'mstour0610@' },
        ];
        
        const matched = adminAccounts.find(a => a.username === username && a.password === password);
        
        if (matched) {
            req.session.adminId = 'admin';
            req.session.adminUsername = username;
            req.session.adminRole = 'admin';
            
            console.log('로그인 성공, 세션 설정됨:', req.session);
            
            // AJAX 요청인지 확인 (Content-Type 헤더로 판단)
            if (req.headers['content-type']?.includes('application/json')) {
                console.log('JSON 응답 전송');
                return res.json({ success: true });
            } else {
                console.log('리다이렉트 응답 전송');
                return res.redirect('/admin');
            }
        } else {
            const errorMsg = '아이디 또는 비밀번호가 올바르지 않습니다.';
            console.log('로그인 실패:', errorMsg);
            
            if (req.headers['content-type']?.includes('application/json')) {
                return res.json({ success: false, message: errorMsg });
            } else {
                return res.render('admin/login', {
                    title: '관리자 로그인',
                    error: errorMsg
                });
            }
        }

    } catch (error) {
        console.error('로그인 오류:', error);
        const errorMsg = '로그인 처리 중 오류가 발생했습니다.';
        
        if (req.headers['content-type']?.includes('application/json')) {
            return res.json({ success: false, message: errorMsg });
        } else {
            return res.render('admin/login', {
                title: '관리자 로그인',
                error: errorMsg
            });
        }
    }
});

// 로그아웃
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// 마이그레이션 실행 (관리자만 접근 가능)
router.get('/run-migrations', requireAuth, async (req, res) => {
    try {
        const { Pool } = require('pg');
        const fs = require('fs');
        const path = require('path');
        
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        // 마이그레이션 추적 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const migrationsDir = path.join(__dirname, '..', 'migrations');
        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort();

        let results = [];
        
        for (const file of migrationFiles) {
            const version = file.replace('.sql', '');
            
            // 이미 적용된 마이그레이션인지 확인
            const { rows } = await pool.query(
                'SELECT version FROM schema_migrations WHERE version = $1',
                [version]
            );
            
            if (rows.length > 0) {
                results.push(`✅ ${file} - 이미 적용됨`);
                continue;
            }
            
            // 마이그레이션 실행
            const migrationSQL = fs.readFileSync(path.join(migrationsDir, file), { encoding: 'utf8' });
            
            await pool.query('BEGIN');
            try {
                await pool.query(migrationSQL);
                await pool.query(
                    'INSERT INTO schema_migrations (version) VALUES ($1)',
                    [version]
                );
                await pool.query('COMMIT');
                results.push(`✅ ${file} - 성공적으로 적용됨`);
            } catch (error) {
                await pool.query('ROLLBACK');
                results.push(`❌ ${file} - 실패: ${error.message}`);
            }
        }
        
        await pool.end();
        
        res.json({
            success: true,
            message: '마이그레이션 완료',
            results: results
        });
        
    } catch (error) {
        console.error('마이그레이션 실행 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 설정 페이지
router.get('/settings', requireAuth, (req, res) => {
    res.render('admin/settings', {
        title: '설정',
        adminUsername: req.session.adminUsername || 'admin'
    });
});

// 급여 관리 페이지 (luxfind01 전용)
router.get('/payroll', requireAuth, (req, res) => {
    const allowedUsers = ['luxfind01', 'kmtour'];
    if (!allowedUsers.includes(req.session.adminUsername)) {
        return res.status(403).render('admin/login', {
            title: '접근 거부',
            error: '접근 권한이 없습니다.'
        });
    }
    res.render('admin/payroll', {
        title: '급여 관리',
        adminUsername: req.session.adminUsername || 'admin'
    });
});

// 계좌 입출금 페이지 (로그인한 관리자 누구나 접근 가능, navbar에서 표시 여부로 제어)
router.get('/bank', requireAuth, (req, res) => {
    res.render('admin/bank', {
        title: '계좌 입출금',
        adminUsername: req.session.adminUsername || 'admin'
    });
});

module.exports = router;
