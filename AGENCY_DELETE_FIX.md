# 업체 삭제 문제 해결

## 🔍 문제 원인

### 에러 메시지
```
error: update or delete on table "pickup_agencies" violates foreign key constraint
"airport_pickups_agency_id_fkey" on table "airport_pickups"
```

### 원인
- `airport_pickups` 테이블이 `pickup_agencies`를 외래키로 참조
- 삭제하려는 업체를 사용하는 픽업 예약이 존재
- 데이터 무결성 보호를 위해 PostgreSQL이 삭제를 거부

## ✅ 해결 방법: 스마트 삭제 시스템

### 구현된 로직

```javascript
1. 삭제 요청 시:
   ├─ 해당 업체를 사용하는 픽업건 확인
   ├─ 사용 중인 픽업건이 있으면 → 비활성화 (is_active = false)
   └─ 사용 중인 픽업건이 없으면 → 완전 삭제 (DELETE)
```

### 1. 백엔드 로직 (routes/pickup.js)

```javascript
// 스마트 삭제 시스템
router.delete('/api/agencies/:id', async (req, res) => {
  // 1. 사용 중인 픽업건 확인
  const usageCount = await pool.query(
    `SELECT COUNT(*) FROM airport_pickups 
     WHERE agency_id = $1 AND status = 'active'`
  );
  
  if (usageCount > 0) {
    // 2-A. 사용 중 → 비활성화
    await pool.query(
      `UPDATE pickup_agencies SET is_active = false WHERE id = $1`
    );
    return { message: '비활성화 처리됨', deactivated: true };
  } else {
    // 2-B. 미사용 → 완전 삭제
    await pool.query(`DELETE FROM pickup_agencies WHERE id = $1`);
    return { message: '삭제 완료', deleted: true };
  }
});
```

### 2. 프론트엔드 UI (agencies.ejs)

#### 리스트 표시
```javascript
// 비활성화된 업체는 회색 배경으로 표시
<tr class="${!a.is_active ? 'table-secondary' : ''}">
  <td>
    ${a.agency_name}
    ${!a.is_active ? '<small>(사용중인 픽업건 있음)</small>' : ''}
  </td>
  <td>
    ${a.is_active 
      ? '🗑️ 삭제 버튼'
      : '✅ 활성화 버튼'
    }
  </td>
</tr>
```

#### 사용자 메시지
```javascript
// 삭제 시도 시
if (deactivated) {
  alert('⚠️ 해당 업체를 사용하는 픽업건이 N건 있어 비활성화 처리되었습니다.');
} else {
  alert('✅ 업체가 삭제되었습니다.');
}
```

## 🎯 주요 기능

### 1. 스마트 삭제
- ✅ 사용 중인 업체 → 자동으로 비활성화
- ✅ 미사용 업체 → 완전 삭제
- ✅ 데이터 무결성 유지

### 2. 재활성화
- ✅ 비활성화된 업체를 다시 활성화 가능
- ✅ "활성화" 버튼으로 원클릭 복구

### 3. 시각적 구분
- ✅ 비활성 업체: 회색 배경
- ✅ 활성 업체: 일반 배경
- ✅ 상태 배지: 활성(녹색) / 비활성(회색)

### 4. 부분 업데이트 지원
- ✅ is_active만 전송해도 업데이트 가능
- ✅ 다른 필드는 기존 값 유지

## 📊 사용 시나리오

### 시나리오 1: 사용 중인 업체 삭제
```
1. 사용자: "ABC 업체" 삭제 클릭
   ↓
2. 시스템: ABC 업체를 사용하는 픽업건 5건 발견
   ↓
3. 시스템: is_active = false로 변경
   ↓
4. 사용자: "5건의 픽업건이 있어 비활성화 처리됨" 메시지 확인
   ↓
5. 리스트: ABC 업체가 회색 배경으로 표시됨
```

### 시나리오 2: 미사용 업체 삭제
```
1. 사용자: "XYZ 업체" 삭제 클릭
   ↓
2. 시스템: XYZ 업체를 사용하는 픽업건 없음
   ↓
3. 시스템: DELETE 쿼리 실행
   ↓
4. 사용자: "업체가 삭제되었습니다" 메시지 확인
   ↓
5. 리스트: XYZ 업체가 목록에서 제거됨
```

### 시나리오 3: 비활성 업체 재활성화
```
1. 사용자: 비활성 업체의 "활성화" 버튼 클릭
   ↓
2. 시스템: is_active = true로 변경
   ↓
3. 사용자: "업체가 활성화되었습니다" 메시지 확인
   ↓
4. 리스트: 일반 배경으로 표시, "삭제" 버튼 표시됨
```

## 🛡️ 안전 장치

### 1. 외래키 제약조건 처리
```javascript
if (error.code === '23503') {  // Foreign key violation
  return '비활성화 처리됩니다';
}
```

### 2. 확인 메시지
```javascript
confirm('정말 삭제하시겠습니까?\n\n※ 픽업 예약이 있으면 비활성화됩니다.')
```

### 3. 상세 피드백
- 사용 중인 픽업건 개수 표시
- 비활성화 이유 설명
- 다음 액션 가이드

## 🚀 테스트 방법

### 1. 사용 중인 업체 삭제 테스트
```sql
-- 1. 픽업 예약이 있는 업체 확인
SELECT a.agency_name, COUNT(ap.id) as pickup_count
FROM pickup_agencies a
LEFT JOIN airport_pickups ap ON a.id = ap.agency_id
WHERE ap.status = 'active'
GROUP BY a.id, a.agency_name
HAVING COUNT(ap.id) > 0;

-- 2. 해당 업체 삭제 시도 → 비활성화 처리됨
-- 3. is_active = false 확인
```

### 2. 미사용 업체 삭제 테스트
```sql
-- 1. 픽업 예약이 없는 업체 확인
SELECT a.* FROM pickup_agencies a
LEFT JOIN airport_pickups ap ON a.id = ap.agency_id
WHERE ap.id IS NULL;

-- 2. 해당 업체 삭제 시도 → 완전 삭제됨
-- 3. 테이블에서 제거됨 확인
```

## 📝 변경 내역

### 파일 수정
1. **routes/pickup.js**
   - DELETE `/api/agencies/:id` - 스마트 삭제 로직
   - PUT `/api/agencies/:id` - 부분 업데이트 지원

2. **views/pickup/agencies.ejs**
   - deleteAgency() - 에러 처리 개선
   - activateAgency() - 재활성화 기능 추가
   - 리스트 렌더링 - 시각적 구분 추가

## 🎉 완료!

이제 업체 삭제가 안전하고 스마트하게 작동합니다:
- ✅ 외래키 에러 없음
- ✅ 데이터 무결성 유지
- ✅ 사용자 친화적인 메시지
- ✅ 재활성화 가능

---

**작성일**: 2025-10-15  
**버전**: 2.0.0
