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
        // 기본 관리자 계정 (환경변수 또는 하드코딩)
        const adminUsername = process.env.ADMIN_USERNAME || 'luxfind01';
        const adminPassword = process.env.ADMIN_PASSWORD || 'vasco01@';
        
        console.log('인증 시도:', { 
            입력아이디: username, 
            입력비밀번호: password,
            설정아이디: adminUsername,
            설정비밀번호: adminPassword 
        });
        
        if (username === adminUsername && password === adminPassword) {
            req.session.adminId = 'admin';
            req.session.adminUsername = username;
            
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

module.exports = router;
