const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS 설정
app.use(cors());

// 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 세션 설정
app.use(session({
    secret: 'guam-savecard-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24시간
    }
}));

// EJS 템플릿 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// JSON 데이터 파일 경로
const vendorsFile = path.join(__dirname, 'data', 'vendors.json');
const reservationsFile = path.join(__dirname, 'data', 'reservations.json');

// 데이터 디렉토리 생성
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}

// 초기 vendors.json 파일 생성
if (!fs.existsSync(vendorsFile)) {
    const initialVendors = [];
    fs.writeFileSync(vendorsFile, JSON.stringify(initialVendors, null, 2));
}

// 라우트 설정
const indexRouter = require('./routes/index');
const adminRouter = require('./routes/admin');

app.use('/', indexRouter);
app.use('/admin', adminRouter);

// 임시 테스트 API
app.get('/api/test', (req, res) => {
    res.json({ message: 'API 연결 성공!', timestamp: new Date() });
});

// Vendors API - 목록 조회
app.get('/api/vendors', (req, res) => {
    try {
        const vendors = JSON.parse(fs.readFileSync(vendorsFile, 'utf8'));
        res.json({
            success: true,
            vendors: vendors.filter(v => v.is_active !== false)
        });
    } catch (error) {
        console.error('수배업체 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 목록을 불러오는데 실패했습니다.'
        });
    }
});

// Vendors API - 신규 등록
app.post('/api/vendors', (req, res) => {
    try {
        const {
            vendor_name,
            vendor_id,
            password,
            email,
            phone,
            contact_person,
            business_type,
            description,
            notification_email,
            products = []
        } = req.body;

        // 필수 필드 검증
        if (!vendor_name || !vendor_id || !password || !email) {
            return res.status(400).json({
                success: false,
                message: '업체명, 아이디, 패스워드, 이메일은 필수입니다.'
            });
        }

        const vendors = JSON.parse(fs.readFileSync(vendorsFile, 'utf8'));
        
        // 중복 체크
        const existingVendor = vendors.find(v => 
            v.vendor_name === vendor_name || v.vendor_id === vendor_id
        );
        
        if (existingVendor) {
            return res.status(400).json({
                success: false,
                message: existingVendor.vendor_name === vendor_name ? 
                    '이미 등록된 업체명입니다.' : '이미 사용중인 아이디입니다.'
            });
        }

        const newVendor = {
            id: vendors.length + 1,
            vendor_name,
            vendor_id,
            password_hash: password, // 실제로는 bcrypt로 해시화해야 함
            email,
            phone: phone || null,
            contact_person: contact_person || null,
            business_type: business_type || null,
            description: description || null,
            notification_email: notification_email || null,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            products: products || [],
            product_count: products.length,
            assignment_count: 0
        };

        vendors.push(newVendor);
        fs.writeFileSync(vendorsFile, JSON.stringify(vendors, null, 2));

        res.json({
            success: true,
            message: '수배업체가 성공적으로 등록되었습니다.',
            vendor: {
                id: newVendor.id,
                vendor_name: newVendor.vendor_name,
                vendor_id: newVendor.vendor_id,
                email: newVendor.email,
                created_at: newVendor.created_at
            }
        });

    } catch (error) {
        console.error('수배업체 등록 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 등록에 실패했습니다.'
        });
    }
});

// Vendors API - 상세 조회
app.get('/api/vendors/:id', (req, res) => {
    try {
        const vendors = JSON.parse(fs.readFileSync(vendorsFile, 'utf8'));
        const vendor = vendors.find(v => v.id == req.params.id && v.is_active !== false);
        
        if (!vendor) {
            return res.status(404).json({
                success: false,
                message: '수배업체를 찾을 수 없습니다.'
            });
        }

        const vendorData = { ...vendor };
        delete vendorData.password_hash;

        res.json({
            success: true,
            vendor: vendorData,
            products: vendor.products || [],
            recent_assignments: []
        });

    } catch (error) {
        console.error('수배업체 상세 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 정보를 불러오는데 실패했습니다.'
        });
    }
});

// Vendors API - 수정
app.put('/api/vendors/:id', (req, res) => {
    try {
        const vendors = JSON.parse(fs.readFileSync(vendorsFile, 'utf8'));
        const vendorIndex = vendors.findIndex(v => v.id == req.params.id);
        
        if (vendorIndex === -1) {
            return res.status(404).json({
                success: false,
                message: '수배업체를 찾을 수 없습니다.'
            });
        }

        const updatedVendor = {
            ...vendors[vendorIndex],
            ...req.body,
            updated_at: new Date().toISOString()
        };

        vendors[vendorIndex] = updatedVendor;
        fs.writeFileSync(vendorsFile, JSON.stringify(vendors, null, 2));

        delete updatedVendor.password_hash;

        res.json({
            success: true,
            message: '수배업체 정보가 수정되었습니다.',
            vendor: updatedVendor
        });

    } catch (error) {
        console.error('수배업체 수정 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 수정에 실패했습니다.'
        });
    }
});

// Vendors API - 삭제
app.delete('/api/vendors/:id', (req, res) => {
    try {
        const vendors = JSON.parse(fs.readFileSync(vendorsFile, 'utf8'));
        const vendorIndex = vendors.findIndex(v => v.id == req.params.id);
        
        if (vendorIndex === -1) {
            return res.status(404).json({
                success: false,
                message: '수배업체를 찾을 수 없습니다.'
            });
        }

        const vendorName = vendors[vendorIndex].vendor_name;
        vendors[vendorIndex].is_active = false;
        vendors[vendorIndex].updated_at = new Date().toISOString();

        fs.writeFileSync(vendorsFile, JSON.stringify(vendors, null, 2));

        res.json({
            success: true,
            message: `${vendorName} 업체가 삭제되었습니다.`
        });

    } catch (error) {
        console.error('수배업체 삭제 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 삭제에 실패했습니다.'
        });
    }
});

// 404 에러 핸들링
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: '페이지를 찾을 수 없습니다.'
    });
});

// 에러 핸들링
app.use((err, req, res, next) => {
    console.error('서버 에러:', err);
    res.status(err.status || 500).json({
        success: false,
        message: '서버에서 오류가 발생했습니다.'
    });
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 괌세이브카드 로컬 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📱 웹사이트: http://localhost:${PORT}`);
    console.log(`🔧 관리자: http://localhost:${PORT}/admin`);
    console.log(`🏢 설정: http://localhost:${PORT}/admin/settings`);
});
