const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initializeData() {
  try {
    console.log('🚀 데이터베이스 초기화 시작...');

    // 기본 여행사 데이터 추가
    console.log('📋 여행사 데이터 추가 중...');
    const agencies = [
      { name: '괌투어', agency_code: 'GUAM001', contact_email: 'info@guamtour.com', contact_phone: '02-1234-5678', sort_order: 1 },
      { name: '사이판여행사', agency_code: 'SAIPAN001', contact_email: 'contact@saipantravel.com', contact_phone: '02-2345-6789', sort_order: 2 },
      { name: '괌패키지투어', agency_code: 'GUAMPKG001', contact_email: 'sales@guampackage.com', contact_phone: '02-3456-7890', sort_order: 3 }
    ];

    for (const agency of agencies) {
      await pool.query(`
        INSERT INTO agencies (name, agency_code, contact_email, contact_phone, sort_order)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (agency_code) DO NOTHING
      `, [agency.name, agency.agency_code, agency.contact_email, agency.contact_phone, agency.sort_order]);
    }

    // 기본 제휴업체 데이터 추가 (JSON 파일에서 마이그레이션)
    console.log('🏪 제휴업체 데이터 추가 중...');
    const storesPath = path.join(__dirname, 'data', 'stores.json');
    if (fs.existsSync(storesPath)) {
      const stores = JSON.parse(fs.readFileSync(storesPath, 'utf8'));
      
      for (const store of stores) {
        await pool.query(`
          INSERT INTO stores (name, category, discount, location, phone, hours, description, image_url, usage_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT DO NOTHING
        `, [
          store.name,
          store.category,
          store.discount,
          store.location,
          store.phone,
          store.hours,
          store.description,
          store.imageUrl,
          store.usage_count || 0
        ]);
      }
      console.log(`✅ ${stores.length}개 제휴업체 데이터 추가 완료`);
    } else {
      // 기본 샘플 제휴업체 데이터
      const sampleStores = [
        {
          name: '괌 면세점',
          category: '쇼핑',
          discount: '전 품목 10% 할인',
          location: '투몬',
          phone: '671-646-9640',
          hours: '매일 10:00-22:00',
          description: '괌 최대 면세점',
          image_url: 'https://via.placeholder.com/300x200?text=Guam+Duty+Free',
          usage_count: 0
        },
        {
          name: '하드록 카페',
          category: '음식점',
          discount: '메인 메뉴 15% 할인',
          location: '투몬',
          phone: '671-647-7625',
          hours: '매일 11:00-24:00',
          description: '유명한 테마 레스토랑',
          image_url: 'https://via.placeholder.com/300x200?text=Hard+Rock+Cafe',
          usage_count: 0
        }
      ];

      for (const store of sampleStores) {
        await pool.query(`
          INSERT INTO stores (name, category, discount, location, phone, hours, description, image_url, usage_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [store.name, store.category, store.discount, store.location, store.phone, store.hours, store.description, store.image_url, store.usage_count]);
      }
      console.log(`✅ ${sampleStores.length}개 샘플 제휴업체 데이터 추가 완료`);
    }

    // 기본 배너 데이터 추가
    console.log('🎯 배너 데이터 추가 중...');
    const banners = [
      {
        advertiser_name: '괌 면세점',
        image_url: 'https://via.placeholder.com/400x120/4CAF50/FFFFFF?text=Guam+Duty+Free',
        link_url: 'https://www.guamdutyfree.com',
        display_order: 1,
        display_locations: [1, 2, 3]
      },
      {
        advertiser_name: '괌 레스토랑',
        image_url: 'https://via.placeholder.com/400x120/2196F3/FFFFFF?text=Guam+Restaurant',
        link_url: 'https://www.guamrestaurant.com',
        display_order: 2,
        display_locations: [1, 3]
      },
      {
        advertiser_name: '괌 액티비티',
        image_url: 'https://via.placeholder.com/400x120/FF9800/FFFFFF?text=Guam+Activity',
        link_url: 'https://www.guamactivity.com',
        display_order: 3,
        display_locations: [1, 2]
      }
    ];

    for (const banner of banners) {
      await pool.query(`
        INSERT INTO banners (advertiser_name, image_url, link_url, display_order, display_locations, is_active, click_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [banner.advertiser_name, banner.image_url, banner.link_url, banner.display_order, banner.display_locations, true, 0]);
    }
    console.log(`✅ ${banners.length}개 배너 데이터 추가 완료`);

    console.log('🎉 데이터베이스 초기화 완료!');
    console.log('📊 추가된 데이터:');
    
    const agencyCount = await pool.query('SELECT COUNT(*) FROM agencies');
    const storeCount = await pool.query('SELECT COUNT(*) FROM stores');
    const bannerCount = await pool.query('SELECT COUNT(*) FROM banners');
    
    console.log(`   - 여행사: ${agencyCount.rows[0].count}개`);
    console.log(`   - 제휴업체: ${storeCount.rows[0].count}개`);
    console.log(`   - 배너: ${bannerCount.rows[0].count}개`);

  } catch (error) {
    console.error('❌ 데이터베이스 초기화 실패:', error);
  } finally {
    await pool.end();
  }
}

initializeData();
