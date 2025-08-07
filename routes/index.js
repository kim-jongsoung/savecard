const express = require('express');
const router = express.Router();

// 메인 페이지
router.get('/', (req, res) => {
    res.render('index', {
        title: '괌세이브카드',
        message: '괌 여행의 필수 할인카드'
    });
});

// 헬스체크
router.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'Guam Save Card'
    });
});

module.exports = router;
