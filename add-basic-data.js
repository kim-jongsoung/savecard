const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addBasicData() {
  try {
    console.log('🚀 기본 데이터 추가 시작...');

    // 기본 여행사 데이터
    console.log('📋 여행사 데이터 추가...');
    const agencies = [
      { name: '괌투어', agency_code: 'GUAM001', contact_email: 'info@guamtour.com', contact_phone: '02-1234-5678', sort_order: 1 },
      { name: '사이판여행사', agency_code: 'SAIPAN001', contact_email: 'contact@saipantravel.com', contact_phone: '02-2345-6789', sort_order: 2 },
      { name: '괌패키지투어', agency_code: 'GUAMPKG001', contact_email: 'sales@guampackage.com', contact_phone: '02-3456-7890', sort_order: 3 }
    ];

    for (const agency of agencies) {
      try {
        await pool.query(`
          INSERT INTO agencies (name, agency_code, contact_email, contact_phone, sort_order)
          VALUES ($1, $2, $3, $4, $5)
        `, [agency.name, agency.agency_code, agency.contact_email, agency.contact_phone, agency.sort_order]);
        console.log(`✅ 여행사 추가: ${agency.name}`);
      } catch (err) {
        if (err.code === '23505') { // unique violation
          console.log(`⚠️ 이미 존재: ${agency.name}`);
        } else {
          throw err;
        }
      }
    }

    // 기본 제휴업체 데이터 (JSON에서 가져오기)
    console.log('🏪 제휴업체 데이터 추가...');
    const storesPath = path.join(__dirname, 'data', 'stores.json');
    
    if (fs.existsSync(storesPath)) {
      const stores = JSON.parse(fs.readFileSync(storesPath, 'utf8'));
      
      for (const store of stores.slice(0, 5)) { // 처음 5개만 추가
        try {
          await pool.query(`
            INSERT INTO stores (name, category, discount, location, phone, hours, description, image_url, usage_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            store.name,
            store.category,
            store.discount,
            store.location,
            store.phone,
            store.hours,
            store.description,
            store.imageUrl || store.image_url,
            store.usage_count || 0
          ]);
          console.log(`✅ 제휴업체 추가: ${store.name}`);
        } catch (err) {
          if (err.code === '23505') {
            console.log(`⚠️ 이미 존재: ${store.name}`);
          } else {
            console.log(`❌ 오류 (${store.name}):`, err.message);
          }
        }
      }
    } else {
      // 샘플 제휴업체 데이터
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
        try {
          await pool.query(`
            INSERT INTO stores (name, category, discount, location, phone, hours, description, image_url, usage_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [store.name, store.category, store.discount, store.location, store.phone, store.hours, store.description, store.image_url, store.usage_count]);
          console.log(`✅ 샘플 제휴업체 추가: ${store.name}`);
        } catch (err) {
          console.log(`❌ 오류 (${store.name}):`, err.message);
        }
      }
    }

    // 기본 배너 데이터
    console.log('🎯 배너 데이터 추가...');
    const banners = [
      {
        advertiser_name: '괌 면세점',
        image_url: 'https://via.placeholder.com/400x120/4CAF50/FFFFFF?text=Guam+Duty+Free',
        link_url: 'https://www.guamdutyfree.com',
        display_order: 1
      },
      {
        advertiser_name: '괌 레스토랑',
        image_url: 'https://via.placeholder.com/400x120/2196F3/FFFFFF?text=Guam+Restaurant',
        link_url: 'https://www.guamrestaurant.com',
        display_order: 2
      }
    ];

    for (const banner of banners) {
      try {
        await pool.query(`
          INSERT INTO banners (advertiser_name, image_url, link_url, display_order, is_active)
          VALUES ($1, $2, $3, $4, $5)
        `, [banner.advertiser_name, banner.image_url, banner.link_url, banner.display_order, true]);
        console.log(`✅ 배너 추가: ${banner.advertiser_name}`);
      } catch (err) {
        console.log(`❌ 배너 오류 (${banner.advertiser_name}):`, err.message);
      }
    }

    console.log('🎉 기본 데이터 추가 완료!');
    
  } catch (error) {
    console.error('❌ 데이터 추가 실패:', error);
  } finally {
    await pool.end();
  }
}

addBasicData();
