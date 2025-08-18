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
    const { username, password } = req.body;

    try {
        // 기본 관리자 계정 (환경변수 또는 하드코딩)
        const adminUsername = process.env.ADMIN_USERNAME || 'luxfind01';
        const adminPassword = process.env.ADMIN_PASSWORD || 'vasco01@';
        
        if (username === adminUsername && password === adminPassword) {
            req.session.adminId = 'admin';
            req.session.adminUsername = username;
            
            // AJAX 요청인지 확인
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.json({ success: true });
            } else {
                return res.redirect('/admin');
            }
        } else {
            const errorMsg = '아이디 또는 비밀번호가 올바르지 않습니다.';
            
            if (req.xhr || req.headers.accept?.includes('application/json')) {
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
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
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
