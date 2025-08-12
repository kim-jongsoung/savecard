-- 괌세이브카드 QR 할인카드 시스템 데이터베이스 스키마
-- MySQL 5.7+ 또는 MariaDB 10.2+ 호환

CREATE DATABASE IF NOT EXISTS guam_savecard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE guam_savecard;

-- 1. 여행사 테이블
CREATE TABLE travel_agencies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL COMMENT '여행사명',
    agency_code VARCHAR(20) UNIQUE NOT NULL COMMENT '여행사 고유 코드',
    contact_email VARCHAR(100) DEFAULT NULL COMMENT '연락처 이메일',
    contact_phone VARCHAR(20) DEFAULT NULL COMMENT '연락처 전화번호',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT='여행사 정보';

-- 2. 할인카드 사용자 테이블
CREATE TABLE savecard_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(50) NOT NULL COMMENT '고객명',
    agency_id INT NOT NULL COMMENT '여행사 ID',
    token VARCHAR(64) UNIQUE NOT NULL COMMENT '고유 토큰(UUID)',
    qr_image_path VARCHAR(255) DEFAULT NULL COMMENT 'QR 이미지 파일 경로',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agency_id) REFERENCES travel_agencies(id) ON DELETE CASCADE,
    INDEX idx_token (token),
    INDEX idx_agency_id (agency_id)
) COMMENT='할인카드 사용자';

-- 3. 카드 사용 이력 테이블
CREATE TABLE card_usages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(64) NOT NULL COMMENT '사용자 토큰',
    store_code VARCHAR(50) NOT NULL COMMENT '제휴처 코드/상호명',
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '사용 시간',
    ip_address VARCHAR(45) DEFAULT NULL COMMENT '사용자 IP',
    user_agent TEXT DEFAULT NULL COMMENT '브라우저 정보',
    INDEX idx_token (token),
    INDEX idx_store_code (store_code),
    INDEX idx_used_at (used_at),
    FOREIGN KEY (token) REFERENCES savecard_users(token) ON DELETE CASCADE
) COMMENT='카드 사용 이력';

-- 4. 광고 배너 테이블
CREATE TABLE banners (
    id INT AUTO_INCREMENT PRIMARY KEY,
    advertiser_name VARCHAR(100) NOT NULL COMMENT '광고주명',
    image_url VARCHAR(500) NOT NULL COMMENT '배너 이미지 URL',
    link_url VARCHAR(500) DEFAULT NULL COMMENT '클릭 시 이동할 URL',
    is_active TINYINT(1) DEFAULT 1 COMMENT '활성화 여부 (1:활성, 0:비활성)',
    display_order INT DEFAULT 0 COMMENT '노출 순서',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_active_order (is_active, display_order)
) COMMENT='광고 배너';

-- 5. 관리자 테이블
CREATE TABLE admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL COMMENT '관리자 ID',
    password_hash VARCHAR(255) NOT NULL COMMENT '비밀번호 해시',
    email VARCHAR(100) DEFAULT NULL COMMENT '이메일',
    last_login TIMESTAMP NULL DEFAULT NULL COMMENT '마지막 로그인',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT='관리자 계정';

-- 기본 데이터 삽입

-- 기본 관리자 계정 (ID: admin, PW: admin123)
INSERT INTO admins (username, password_hash, email) VALUES 
('admin', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin@guamsavecard.com');

-- 샘플 여행사 데이터
INSERT INTO travel_agencies (name, agency_code, contact_email, contact_phone) VALUES 
('괌투어', 'GUAM001', 'info@guamtour.com', '02-1234-5678'),
('사이판여행사', 'SAIPAN001', 'contact@saipantravel.com', '02-2345-6789'),
('괌패키지투어', 'GUAMPKG001', 'sales@guampackage.com', '02-3456-7890');

-- 샘플 광고 배너
INSERT INTO banners (advertiser_name, image_url, link_url, is_active, display_order) VALUES 
('괌 면세점', 'https://via.placeholder.com/400x120/4CAF50/FFFFFF?text=Guam+Duty+Free', 'https://www.guamdutyfree.com', 1, 1),
('괌 레스토랑', 'https://via.placeholder.com/400x120/2196F3/FFFFFF?text=Guam+Restaurant', 'https://www.guamrestaurant.com', 1, 2),
('괌 액티비티', 'https://via.placeholder.com/400x120/FF9800/FFFFFF?text=Guam+Activity', 'https://www.guamactivity.com', 1, 3);

-- 인덱스 최적화
OPTIMIZE TABLE travel_agencies;
OPTIMIZE TABLE savecard_users;
OPTIMIZE TABLE card_usages;
OPTIMIZE TABLE banners;
OPTIMIZE TABLE admins;
