"use strict";

/*
 * Shared commerce research/category registry.
 * Manual supplier research and automatic regional research must read the same
 * focused product vocabulary so a category added here is searchable by both.
 * This module builds queries only; it does not approve or publish products.
 */

const VERSION = "commerce-research-category-registry-v1.0.0";
const FOCUS_KEYS = Object.freeze([
  "beauty_personal_care",
  "electronics_accessories",
  "home_appliances_living"
]);

const TERMS = Object.freeze({
  en:Object.freeze({
    beauty_personal_care:"beauty personal care skincare serum ampoule essence toner moisturizer cream lotion cleanser cleansing foam sunscreen sun care sheet mask makeup foundation cushion BB cream CC cream lipstick lip tint lip balm mascara eyeliner eyebrow eyeshadow blush concealer face powder nail polish manicure shampoo conditioner hair treatment hair mask body wash body lotion perfume fragrance grooming razor electric shaver beauty device LED mask galvanic facial massager scalp care hair straightener hair styler",
    electronics_accessories:"small electronics bluetooth speaker portable speaker earbuds bluetooth earphones headphones microphone tablet USB hub USB flash drive memory stick cable charger power bank webcam docking station adapter",
    home_appliances_living:"small home appliances portable fan handheld fan fan circulator electric kettle toaster blender mixer coffee maker coffee machine humidifier dehumidifier air purifier vacuum cleaner hair dryer"
  }),
  ko:Object.freeze({
    beauty_personal_care:"뷰티 개인용품 화장품 스킨케어 세럼 앰플 에센스 토너 보습제 크림 로션 클렌저 클렌징폼 선크림 자외선차단 마스크팩 메이크업 파운데이션 쿠션 BB크림 CC크림 립스틱 립틴트 립밤 마스카라 아이라이너 아이브로우 아이섀도 블러셔 컨실러 페이스파우더 네일 매니큐어 샴푸 린스 컨디셔너 트리트먼트 헤어팩 바디워시 바디로션 향수 그루밍 면도기 전동면도기 뷰티기기 피부미용기기 LED마스크 갈바닉 페이스마사지기 두피관리기 고데기 헤어스타일러",
    electronics_accessories:"소형 전자제품 블루투스 스피커 휴대용 스피커 이어버드 블루투스 이어폰 헤드폰 마이크 태블릿 USB 허브 USB 메모리 플래시 드라이브 케이블 충전기 보조배터리 웹캠 도킹스테이션 어댑터",
    home_appliances_living:"소형가전 휴대용 선풍기 손선풍기 선풍기 써큘레이터 전기포트 토스터 블렌더 믹서 커피메이커 커피머신 가습기 제습기 공기청정기 청소기 헤어드라이어"
  }),
  ja:Object.freeze({
    beauty_personal_care:"美容 パーソナルケア 化粧品 スキンケア 美容液 アンプル エッセンス 化粧水 保湿 クリーム ローション 洗顔 クレンジング 日焼け止め シートマスク メイク ファンデーション クッション BBクリーム CCクリーム 口紅 リップティント リップバーム マスカラ アイライナー アイブロウ アイシャドウ チーク コンシーラー フェイスパウダー ネイル マニキュア シャンプー コンディショナー トリートメント ヘアマスク ボディソープ ボディローション 香水 グルーミング 電気シェーバー 美容機器 LEDマスク ガルバニック フェイスマッサージャー 頭皮ケア ヘアアイロン ヘアスタイラー",
    electronics_accessories:"小型電子機器 Bluetoothスピーカー ポータブルスピーカー イヤホン Bluetoothイヤホン ヘッドホン マイク タブレット USBハブ USBメモリ ケーブル 充電器 モバイルバッテリー ウェブカメラ ドッキングステーション アダプター",
    home_appliances_living:"小型家電 携帯扇風機 ハンディファン 扇風機 サーキュレーター 電気ケトル トースター ブレンダー ミキサー コーヒーメーカー 加湿器 除湿機 空気清浄機 掃除機 ヘアドライヤー"
  }),
  "zh-hans":Object.freeze({
    beauty_personal_care:"美容 个护 化妆品 护肤 精华 安瓶 爽肤水 保湿 面霜 乳液 洁面 防晒 面膜 彩妆 粉底 气垫 BB霜 CC霜 口红 唇釉 润唇膏 睫毛膏 眼线 眉笔 眼影 腮红 遮瑕 散粉 美甲 指甲油 洗发水 护发素 发膜 沐浴露 身体乳 香水 剃须刀 电动剃须刀 美容仪 LED面罩 导入仪 面部按摩仪 头皮护理 直发器 美发造型器",
    electronics_accessories:"小型电子产品 蓝牙音箱 便携音箱 耳塞 蓝牙耳机 头戴耳机 麦克风 平板电脑 USB集线器 U盘 数据线 充电器 充电宝 摄像头 扩展坞 适配器",
    home_appliances_living:"小家电 便携风扇 手持风扇 电风扇 空气循环扇 电热水壶 烤面包机 搅拌机 咖啡机 加湿器 除湿器 空气净化器 吸尘器 吹风机"
  }),
  "zh-hant":Object.freeze({
    beauty_personal_care:"美容 個護 化妝品 護膚 精華 安瓶 化妝水 保濕 面霜 乳液 潔面 防曬 面膜 彩妝 粉底 氣墊 BB霜 CC霜 口紅 唇釉 潤唇膏 睫毛膏 眼線 眉筆 眼影 腮紅 遮瑕 蜜粉 美甲 指甲油 洗髮精 潤髮乳 髮膜 沐浴乳 身體乳 香水 刮鬍刀 電動刮鬍刀 美容儀 LED面罩 導入儀 臉部按摩器 頭皮護理 離子夾 美髮造型器",
    electronics_accessories:"小型電子產品 藍牙音箱 可攜式音箱 耳塞 藍牙耳機 頭戴耳機 麥克風 平板電腦 USB集線器 隨身碟 數據線 充電器 行動電源 網路攝影機 擴充基座 轉接器",
    home_appliances_living:"小家電 可攜式風扇 手持風扇 電風扇 空氣循環扇 電熱水壺 烤麵包機 果汁機 攪拌機 咖啡機 加濕器 除濕機 空氣清淨機 吸塵器 吹風機"
  })
});

function text(v){ return String(v == null ? "" : v).trim(); }
function baseLocale(locale){ return text(locale).toLowerCase().split("-")[0] || "en"; }
function localeKey(locale){
  const raw=text(locale).toLowerCase();
  if(raw === "zh-hans" || raw === "zh-cn" || raw === "zh-sg") return "zh-hans";
  if(raw === "zh-hant" || raw === "zh-tw" || raw === "zh-hk" || raw === "zh-mo") return "zh-hant";
  const base=baseLocale(raw);
  return TERMS[base] ? base : "en";
}
function suffixFor(locale,key){
  const pack=TERMS[localeKey(locale)] || TERMS.en;
  return text(pack[key] || TERMS.en[key]);
}
function focusedKeys(){ return FOCUS_KEYS.slice(); }

module.exports={VERSION,FOCUS_KEYS,TERMS,localeKey,suffixFor,focusedKeys};
