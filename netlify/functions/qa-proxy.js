/**
 * qa-proxy.js
 * ------------------------------------------------------------
 * IGDC Q&A central gateway.
 * - Public Q&A receives questions from support/front pages.
 * - Gives a safe email-style first answer from platform knowledge.
 * - Routes only important questions to the Admin Q&A inbox.
 * - Read-only/admin-list endpoints are paged and light.
 *
 * ENV supported:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY (optional; used server-side for admin read/update when present)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { bearerToken } = require("./lib/maru-ai-access-control");

const VERSION = "igdc-qa-proxy-v1.3.0-public-ai-owner-delete";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-IGDC-Member-Token",
  "Cache-Control": "no-store"
};

function s(v){ return v == null ? "" : String(v); }
function low(v){ return s(v).trim().toLowerCase(); }
function safeNum(v, d){ const n = Number(v); return Number.isFinite(n) ? n : d; }
function json(statusCode, body){ return { statusCode, headers: Object.assign({ "Content-Type":"application/json; charset=utf-8" }, CORS), body: JSON.stringify(body) }; }
function hash(v){ return crypto.createHash("sha1").update(String(v||"")).digest("hex").slice(0,16); }
function nowIso(){ return new Date().toISOString(); }

const QA_RATE_STATE = new Map();
function requestIp(event){
  const headers = event && event.headers || {};
  const raw = headers["x-nf-client-connection-ip"] || headers["X-Nf-Client-Connection-Ip"] || headers["x-forwarded-for"] || "unknown";
  return String(raw || "unknown").split(",")[0].trim().slice(0,96) || "unknown";
}
function qaRateAllowed(event){
  const now = Date.now();
  const configured = Number(process.env.IGDC_QA_PUBLIC_RPM);
  const limit = Number.isFinite(configured) && configured > 0 ? Math.min(120, Math.floor(configured)) : 12;
  const key = requestIp(event);
  const row = QA_RATE_STATE.get(key) || { startedAt: now, count: 0 };
  if (now - row.startedAt >= 60 * 1000) { row.startedAt = now; row.count = 0; }
  row.count += 1;
  QA_RATE_STATE.set(key, row);
  return row.count <= limit;
}

async function fetchCompat(url, init){
  if (typeof fetch === "function") return fetch(url, init);
  const mod = await import("node-fetch");
  return mod.default(url, init);
}

function getHeader(event, name){
  const headers = event && event.headers || {};
  const wanted = low(name);
  for (const [key, value] of Object.entries(headers)) {
    if (low(key) === wanted) return cleanText(value, 10000);
  }
  return "";
}

function normalizeRole(value){
  return low(value).replace(/[\s.\-]+/g, "_");
}

function memberVerifyUrl(){
  const explicit = cleanText(process.env.MARU_AUTH_VERIFY_URL, 1000);
  const base = cleanText(process.env.URL || process.env.DEPLOY_PRIME_URL || "https://igdcglobal.com", 1000).replace(/\/+$/, "");
  const raw = explicit || `${base}/.netlify/functions/member-admin?action=me`;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch (_) { return ""; }
}

async function verifyPlatformMemberToken(token){
  token = cleanText(token, 10000);
  if (!token) return null;
  const url = memberVerifyUrl();
  if (!url) return null;
  try {
    const response = await fetchCompat(url, {
      method:"GET",
      headers:{ Authorization:`Bearer ${token}`, Accept:"application/json" },
      redirect:"error"
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload || payload.ok !== true || !payload.me) return null;
    const me = payload.me || {};
    const roles = [...new Set([...(Array.isArray(me.roles) ? me.roles : []), me.role]
      .flatMap(v => typeof v === "string" ? v.split(",") : [])
      .map(normalizeRole).filter(Boolean))];
    return {
      userId: cleanText(me.user_id || me.sub, 300),
      email: cleanText(me.email, 500).toLowerCase(),
      roles,
      isAdmin: roles.includes("owner") || roles.includes("admin")
    };
  } catch (_) { return null; }
}

async function verifySupabaseUserToken(token){
  token = cleanText(token, 10000);
  if (!token || !SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) return null;
  const apiKey = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;
  try {
    const response = await fetchCompat(`${SUPABASE_URL.replace(/\/$/,"")}/auth/v1/user`, {
      method:"GET",
      headers:{ apikey:apiKey, Authorization:`Bearer ${token}`, Accept:"application/json" }
    });
    if (!response.ok) return null;
    const user = await response.json();
    const id = cleanText(user && user.id, 300);
    return id ? { userId:id, email:cleanText(user.email,500).toLowerCase() } : null;
  } catch (_) { return null; }
}

async function isSupabaseAdmin(userId, dbToken){
  userId = cleanText(userId, 300);
  if (!userId) return false;
  try {
    const rows = await sbFetch(`igdc_admins?select=uid&uid=eq.${encodeURIComponent(userId)}&limit=1`, { method:"GET", headers:{ Prefer:"" } }, true, dbToken);
    return Array.isArray(rows) && rows.some(row => cleanText(row && row.uid, 300) === userId);
  } catch (_) { return false; }
}

async function requestIdentity(event){
  const authToken = bearerToken(event);
  const memberHeaderToken = getHeader(event, "x-igdc-member-token");
  let supabase = await verifySupabaseUserToken(authToken);
  let member = await verifyPlatformMemberToken(memberHeaderToken);
  if (!member && !supabase && authToken) member = await verifyPlatformMemberToken(authToken);
  const dbToken = supabase ? authToken : "";
  const supabaseAdmin = supabase ? await isSupabaseAdmin(supabase.userId, dbToken) : false;
  return {
    supabaseUserId: supabase && supabase.userId || "",
    memberUserId: member && member.userId || "",
    roles: member && member.roles || [],
    isAdmin: !!(supabaseAdmin || member && member.isAdmin),
    dbToken
  };
}

function parseBody(event){
  try{
    const raw = event && event.body ? event.body : "";
    if (!raw) return {};
    const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    return JSON.parse(text || "{}");
  }catch(e){ return {}; }
}

function readKnowledge(){
  const candidates = [
    path.join(__dirname || ".", "data", "igdc-support-knowledge.json"),
    path.join(process.cwd(), "netlify", "functions", "data", "igdc-support-knowledge.json"),
    path.join(process.cwd(), "data", "igdc-support-knowledge.json")
  ];
  for (const p of candidates){
    try{
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, "utf8");
      return Object.assign(JSON.parse(text), { _path:p, _hash:hash(text) });
    }catch(e){}
  }
  return fallbackKnowledge();
}

function fallbackKnowledge(){
  return {
    version:"fallback",
    platform:{ name:"IGDC Global Hub", supportEmail:"igdcplatform@gmail.com" },
    publicGuidance:{
      upgrade:"회원 승급 신청은 회원 전용 페이지에서 신청할 수 있습니다.",
      qna:"간단한 질문은 Q&A 질의란을 통해 질문하면 AI 상담사가 신속히 답변을 드립니다.",
      downloads:"프로그램 다운로드 파일은 /downloads/ 경로에 게시된 뒤 활성화됩니다.",
      payment:"결제 기능은 PG/카드사 승인 및 운영자 설정 이후 활성화됩니다. 결제·환불 확정은 관리자 검토가 필요합니다."
    },
    adminRequiredCategories:["access","payment","download","bug","business","legal","security"],
    adminRequiredKeywords:["관리자","권한","승급","결제","환불","취소","정기결제","다운로드 오류","오류","버그","기업","기관","계약","법적","보안","개인정보","admin","access","permission","payment","refund","subscription","download error","bug","business","legal","security"],
    aiAnswerPolicy:{ noLegalAdvice:true, noPaymentApproval:true, noAdminApproval:true, noSensitiveDisclosure:true }
  };
}

function includesAny(text, words){
  const t = low(text);
  return (words || []).some(w => w && t.includes(low(w)));
}

const LANG_NAMES = { ko:"Korean", en:"English", zh:"Simplified Chinese", zht:"Traditional Chinese", ja:"Japanese", es:"Spanish", fr:"French", de:"German", ru:"Russian", pt:"Portuguese", it:"Italian", ar:"Arabic", vi:"Vietnamese", th:"Thai", id:"Indonesian", hi:"Hindi", tr:"Turkish", fa:"Persian", bn:"Bengali", ur:"Urdu", sw:"Swahili", ta:"Tamil", hu:"Hungarian", ms:"Malay", nl:"Dutch", pl:"Polish", sv:"Swedish", tl:"Filipino", uk:"Ukrainian", uz:"Uzbek" };

function normalizeLang(lang){
  const raw = low(lang || "ko");
  if (!raw) return "ko";
  if (["zh-hant","zh_tw","zh-tw","zh-hk","zh_hk"].includes(raw)) return "zht";
  const base = raw.split(/[-_]/)[0];
  return QA_I18N[raw] ? raw : (QA_I18N[base] ? base : "en");
}

const QA_I18N = {
  ko:{hello:"안녕하세요. IGDC Global Hub입니다.",intro:"문의하신 내용에 대해 안내드립니다.",thanks:"감사합니다.",admin:"추가 확인이 필요한 문의로 분류되어 관리자 Q&A 수신함으로 전달됩니다.",done:"현재 문의는 AI 상담사가 일반 안내로 1차 답변했습니다.",b:{membership:"회원 등록은 플랫폼의 로그인 또는 회원 전용 흐름을 통해 진행합니다. 가입이나 로그인에는 본인이 실제로 확인할 수 있는 이메일을 사용해 주세요. 인증, 비밀번호, 계정 이메일 변경처럼 본인 확인이 필요한 문제는 관리자 검토 대상으로 접수됩니다.",access:"회원 승급 신청은 회원 전용 페이지에서 신청할 수 있습니다. 관리자·소유자·특수 권한은 운영자가 확인한 계정에만 부여됩니다.",payment:"결제 기능은 PG/카드사 승인 및 운영자 설정 이후 활성화됩니다. 결제, 환불, 정기결제, 취소 확정은 자동으로 확정하지 않고 관리자 검토가 필요한 항목입니다.",download:"프로그램 다운로드는 출시 파일이 /downloads/ 경로에 업로드된 뒤 활성화됩니다. 파일이 준비 중이면 다운로드가 열리지 않을 수 있습니다.",commerce:"IGDC는 상품, 콘텐츠, 서비스, 외부 판매자 또는 제공자를 연결하는 플랫폼 역할을 합니다. IGDC가 직접 판매자로 명시된 경우를 제외하고, 상품 상세, 가격, 배송, 환불, 이용 조건, 거래 이행 책임은 해당 판매자 또는 제공자와 이용자 사이의 조건을 우선 확인해야 합니다. 거래 분쟁이나 중요한 상품 문제는 관리자 검토 대상으로 접수됩니다.",bug:"오류 신고는 확인이 필요한 항목입니다. 발생한 페이지, 사용 기기, 브라우저, 오류 화면 또는 증상을 함께 남기면 관리자 검토에 도움이 됩니다.",business:"기관, 기업, 제휴, 계약 관련 문의는 자동 답변만으로 확정하기 어렵기 때문에 관리자 검토 대상으로 접수됩니다.",legalSecurity:"법적, 보안, 개인정보 또는 계정 보호와 관련된 문의는 자동 확정 답변을 제공하지 않으며 관리자 검토 대상으로 접수됩니다.",general:"IGDC 플랫폼 이용 안내 기준에 따라 확인했습니다. 일반적인 이용 방법, 다운로드 준비 상태, 회원 등록·승급 위치, 결제 안내 등은 도움말과 Q&A에서 먼저 안내됩니다."}},
  en:{hello:"Hello. This is IGDC Global Hub.",intro:"Thank you for your inquiry. Please see the guidance below.",thanks:"Thank you.",admin:"This inquiry requires additional review and has been routed to the Admin Q&A inbox.",done:"This inquiry has been answered first by the AI support assistant.",b:{membership:"Membership registration is handled through the platform login or member-only flow. Please use an email address you can actually receive. Verification, password, account email changes, and identity-related issues may require admin review.",access:"Membership upgrade requests can be submitted from the member-only page. Admin, owner, or special permissions are granted only to accounts verified by the operator.",payment:"Payment features become active after PG/card approval and operator setup. Payment, refund, recurring billing, and cancellation decisions are not confirmed automatically and may require admin review.",download:"Program downloads become active after release files are uploaded under the /downloads/ path. If the file is still pending, the download may not open.",commerce:"IGDC operates as a platform connecting products, content, services, external sellers, and providers. Unless IGDC is clearly stated as the direct seller, item details, pricing, delivery, refund terms, usage conditions, and transaction performance should be checked with the seller or provider. Disputes or important product issues are routed for admin review.",bug:"Error reports require review. Please include the page, device, browser, screenshot, or symptoms if possible.",business:"Institutional, enterprise, partnership, and contract inquiries cannot be confirmed by an automatic answer and will be routed for admin review.",legalSecurity:"Legal, security, privacy, or account protection inquiries cannot be finally answered automatically and will be routed for admin review.",general:"Your question has been reviewed under IGDC platform guidance. General usage, download readiness, membership registration and upgrade location, and payment notices are first handled through Help and Q&A."}},
  zh:{hello:"您好，这里是 IGDC Global Hub。",intro:"关于您的咨询，说明如下。",thanks:"谢谢。",admin:"此咨询需要进一步确认，已转交至管理员 Q&A 收件箱。",done:"此咨询已由 AI 客服先行答复。",b:{membership:"会员注册通过平台登录或会员专用流程进行。请使用本人可以接收邮件的邮箱。认证、密码、账号邮箱变更等需要身份确认的问题可能需要管理员审核。",access:"会员升级申请可在会员专用页面提交。管理员、所有者或特殊权限仅授予经运营方确认的账号。",payment:"支付功能会在 PG/银行卡审核和运营设置完成后启用。支付、退款、定期付款和取消确认不会自动确定，可能需要管理员审核。",download:"程序下载会在发布文件上传到 /downloads/ 路径后启用。文件尚未准备时，下载可能无法打开。",commerce:"IGDC 作为连接商品、内容、服务、外部卖家或提供者的平台。除非明确标注 IGDC 为直接卖家，否则商品详情、价格、配送、退款、使用条件和交易履行责任应优先与卖家或提供者确认。交易纠纷或重要商品问题将转交管理员审核。",bug:"错误报告需要确认。请尽可能提供发生页面、设备、浏览器、截图或症状。",business:"机构、企业、合作和合同咨询不能仅凭自动答复确认，将转交管理员审核。",legalSecurity:"法律、安全、隐私或账号保护问题不会由自动答复最终确认，将转交管理员审核。",general:"已按 IGDC 平台指南确认您的问题。一般使用、下载准备、会员注册/升级位置和支付说明会先通过帮助与 Q&A 안내。"}},
  zht:{hello:"您好，這裡是 IGDC Global Hub。",intro:"關於您的諮詢，說明如下。",thanks:"謝謝。",admin:"此諮詢需要進一步確認，已轉交至管理員 Q&A 收件箱。",done:"此諮詢已由 AI 客服先行回覆。",b:{membership:"會員註冊透過平台登入或會員專用流程進行。請使用本人可以接收郵件的電子郵件。驗證、密碼、帳號郵件變更等需要身分確認的問題可能需要管理員審核。",access:"會員升級申請可在會員專用頁面提交。管理員、所有者或特殊權限僅授予經營運方確認的帳號。",payment:"付款功能會在 PG/刷卡審核及營運設定完成後啟用。付款、退款、定期付款及取消確認不會自動確定，可能需要管理員審核。",download:"程式下載會在發布檔案上傳至 /downloads/ 路徑後啟用。檔案尚未準備時，下載可能無法開啟。",commerce:"IGDC 作為連接商品、內容、服務、外部賣家或提供者的平台。除非明確標示 IGDC 為直接賣家，商品詳情、價格、配送、退款、使用條件及交易履行責任應優先與賣家或提供者確認。交易糾紛或重要商品問題將轉交管理員審核。",bug:"錯誤回報需要確認。請盡可能提供發生頁面、裝置、瀏覽器、截圖或症狀。",business:"機構、企業、合作與合約諮詢無法僅由自動回覆確認，將轉交管理員審核。",legalSecurity:"法律、安全、隱私或帳號保護問題不會由自動回覆最終確認，將轉交管理員審核。",general:"已依 IGDC 平台指南確認您的問題。一般使用、下載準備、會員註冊/升級位置及付款說明會先透過說明與 Q&A 안내。"}},
  ja:{hello:"こんにちは。IGDC Global Hubです。",intro:"お問い合わせ内容についてご案内いたします。",thanks:"ありがとうございます。",admin:"追加確認が必要なお問い合わせとして管理者Q&A受信箱へ送信されます。",done:"このお問い合わせはAIサポートが一次回答しました。",b:{membership:"会員登録はプラットフォームのログインまたは会員専用の流れで行います。受信可能なご本人のメールアドレスを使用してください。認証、パスワード、登録メール変更など本人確認が必要な内容は管理者確認となる場合があります。",access:"会員アップグレード申請は会員専用ページから行えます。管理者、所有者、特別権限は運営者が確認したアカウントにのみ付与されます。",payment:"決済機能はPG/カード承認および運営設定後に有効化されます。決済、返金、定期決済、取消の確定は自動では行わず、管理者確認が必要な場合があります。",download:"プログラムダウンロードはリリースファイルが /downloads/ にアップロードされた後に有効になります。準備中の場合は開けないことがあります。",commerce:"IGDCは商品、コンテンツ、サービス、外部販売者または提供者をつなぐプラットフォームです。IGDCが直接販売者と明示される場合を除き、商品詳細、価格、配送、返金、利用条件、取引履行責任は販売者または提供者との条件を確認してください。取引紛争や重要な商品問題は管理者確認に回されます。",bug:"エラー報告は確認が必要です。発生ページ、端末、ブラウザ、画面または症状を添えてください。",business:"機関、企業、提携、契約関連のお問い合わせは自動回答だけでは確定できないため管理者確認となります。",legalSecurity:"法的、安全、個人情報、アカウント保護に関するお問い合わせは自動確定回答を行わず管理者確認となります。",general:"IGDCプラットフォーム案内に基づいて確認しました。一般的な利用方法、ダウンロード準備、会員登録・アップグレード、決済案内はヘルプとQ&Aでまず案内されます。"}},
  es:{hello:"Hola. Este es IGDC Global Hub.",intro:"Gracias por su consulta. Le indicamos lo siguiente.",thanks:"Gracias.",admin:"Esta consulta requiere revisión adicional y se ha enviado a la bandeja Q&A del administrador.",done:"La consulta fue respondida primero por el asistente de IA.",b:{membership:"El registro de miembros se realiza mediante el inicio de sesión o el flujo para miembros. Use un correo que pueda recibir. Verificación, contraseña, cambio de correo y asuntos de identidad pueden requerir revisión del administrador.",access:"Las solicitudes de ascenso de membresía se realizan en la página exclusiva para miembros. Permisos de administrador, propietario o especiales solo se conceden a cuentas verificadas.",payment:"Los pagos se activan tras aprobación PG/tarjeta y configuración del operador. Pago, reembolso, suscripción y cancelación pueden requerir revisión del administrador.",download:"Las descargas se activan cuando los archivos se suben a /downloads/. Si el archivo no está listo, la descarga puede no abrirse.",commerce:"IGDC funciona como plataforma que conecta productos, contenidos, servicios, vendedores o proveedores externos. Salvo que IGDC figure como vendedor directo, detalles, precio, entrega, reembolso, condiciones y cumplimiento corresponden a vendedor/proveedor y usuario. Disputas o asuntos importantes se envían a revisión.",bug:"Los errores requieren revisión. Incluya página, dispositivo, navegador, captura o síntomas.",business:"Consultas de instituciones, empresas, alianzas o contratos requieren revisión del administrador.",legalSecurity:"Consultas legales, de seguridad, privacidad o protección de cuenta no se resuelven definitivamente de forma automática y pasan a revisión.",general:"Su consulta fue revisada según la guía de IGDC. Uso general, descargas, registro/ascenso y pagos se atienden primero por Ayuda y Q&A."}},
  fr:{hello:"Bonjour. Ici IGDC Global Hub.",intro:"Merci pour votre demande. Voici les informations.",thanks:"Merci.",admin:"Cette demande nécessite une vérification et a été transmise à la boîte Q&A administrateur.",done:"Cette demande a reçu une première réponse de l’assistant IA.",b:{membership:"L’inscription se fait via la connexion ou le parcours membre. Utilisez une adresse e-mail que vous pouvez recevoir. Vérification, mot de passe, changement d’e-mail ou identité peuvent nécessiter une revue administrateur.",access:"La demande de montée de niveau se fait dans la page membre. Les droits admin, propriétaire ou spéciaux sont accordés uniquement aux comptes vérifiés.",payment:"Le paiement est activé après approbation PG/carte et configuration. Paiement, remboursement, abonnement et annulation peuvent nécessiter une revue administrateur.",download:"Les téléchargements sont actifs après publication des fichiers dans /downloads/. Si le fichier n’est pas prêt, il peut ne pas s’ouvrir.",commerce:"IGDC agit comme plateforme reliant produits, contenus, services, vendeurs ou fournisseurs externes. Sauf indication qu’IGDC est vendeur direct, détails, prix, livraison, remboursement, conditions et exécution relèvent du vendeur/fournisseur et de l’utilisateur. Les litiges importants sont transmis à l’administrateur.",bug:"Un signalement d’erreur nécessite une vérification. Indiquez page, appareil, navigateur, capture ou symptôme.",business:"Les demandes institutionnelles, entreprises, partenariats ou contrats nécessitent une revue administrateur.",legalSecurity:"Les demandes juridiques, sécurité, confidentialité ou protection de compte ne reçoivent pas de décision automatique et sont transmises à l’administrateur.",general:"Votre demande a été examinée selon les règles IGDC. Usage, téléchargements, inscription/upgrade et paiement sont d’abord traités par Aide et Q&A."}},
  de:{hello:"Hallo. Hier ist IGDC Global Hub.",intro:"Vielen Dank für Ihre Anfrage. Nachfolgend die Hinweise.",thanks:"Vielen Dank.",admin:"Diese Anfrage benötigt weitere Prüfung und wurde an den Admin-Q&A-Posteingang weitergeleitet.",done:"Diese Anfrage wurde zuerst vom KI-Support beantwortet.",b:{membership:"Die Registrierung erfolgt über Login oder Mitgliederbereich. Verwenden Sie eine empfangsbereite eigene E-Mail. Verifizierung, Passwort, E-Mail-Änderung und Identitätsfragen können Admin-Prüfung erfordern.",access:"Mitglieds-Upgrades können im Mitgliederbereich beantragt werden. Admin-, Owner- oder Sonderrechte erhalten nur geprüfte Konten.",payment:"Zahlungen werden nach PG/Kartenfreigabe und Betreiberkonfiguration aktiviert. Zahlung, Erstattung, Abo und Kündigung können Admin-Prüfung erfordern.",download:"Downloads werden aktiv, sobald Dateien unter /downloads/ hochgeladen sind. Ist die Datei noch nicht bereit, öffnet sie ggf. nicht.",commerce:"IGDC ist eine Plattform zur Verbindung von Produkten, Inhalten, Diensten, externen Verkäufern oder Anbietern. Sofern IGDC nicht als direkter Verkäufer ausgewiesen ist, sind Details, Preis, Lieferung, Erstattung, Bedingungen und Erfüllung mit Verkäufer/Anbieter zu prüfen. Streitfälle gehen an Admin-Prüfung.",bug:"Fehlermeldungen benötigen Prüfung. Bitte Seite, Gerät, Browser, Screenshot oder Symptome angeben.",business:"Institutionelle, Unternehmens-, Partner- oder Vertragsanfragen erfordern Admin-Prüfung.",legalSecurity:"Rechts-, Sicherheits-, Datenschutz- oder Kontoschutzfragen werden nicht automatisch endgültig beantwortet und gehen an Admin-Prüfung.",general:"Ihre Anfrage wurde nach IGDC-Richtlinien geprüft. Nutzung, Downloads, Registrierung/Upgrade und Zahlungshinweise laufen zuerst über Hilfe und Q&A."}},
  ru:{hello:"Здравствуйте. Это IGDC Global Hub.",intro:"Спасибо за обращение. Информация ниже.",thanks:"Спасибо.",admin:"Запрос требует дополнительной проверки и передан в админскую Q&A-почту.",done:"Запрос предварительно обработан ИИ-поддержкой.",b:{membership:"Регистрация выполняется через вход или поток для участников. Используйте доступный вам e-mail. Проверка, пароль, смена e-mail и вопросы личности могут требовать проверки администратора.",access:"Запрос на повышение статуса подается на странице для участников. Права администратора, владельца или специальные права выдаются только проверенным аккаунтам.",payment:"Платежи активируются после одобрения PG/карты и настройки. Оплата, возврат, подписка и отмена могут требовать проверки администратора.",download:"Загрузки активируются после размещения файлов в /downloads/. Если файл не готов, загрузка может не открыться.",commerce:"IGDC является платформой, соединяющей товары, контент, услуги, внешних продавцов или поставщиков. Если IGDC не указан прямым продавцом, детали, цена, доставка, возврат, условия и исполнение проверяются с продавцом/поставщиком. Споры передаются администратору.",bug:"Сообщение об ошибке требует проверки. Укажите страницу, устройство, браузер, скриншот или симптомы.",business:"Вопросы учреждений, компаний, партнерства и договоров требуют проверки администратора.",legalSecurity:"Юридические, security, privacy или защита аккаунта не получают окончательного автоответа и передаются администратору.",general:"Ваш вопрос рассмотрен по правилам IGDC. Использование, загрузки, регистрация/повышение и платежи сначала обрабатываются через Help и Q&A."}}
};
["pt","it","ar","vi","th","id","hi","tr","fa","bn","ur","sw","ta","hu","ms","nl","pl","sv","tl","uk","uz"].forEach(function(code){ QA_I18N[code] = QA_I18N[code] || QA_I18N.en; });

function classify(question, meta, k){
  const q = s(question);
  const m = meta || {};
  const t = low([q, m.topic, m.page, m.category, m.source].filter(Boolean).join(" "));
  let category = "general";
  const rules = [
    ["security", ["보안","해킹","계정 도용","개인정보","privacy","security","hack","abuse","phishing","fraud"]],
    ["legal", ["법적","소송","계약서","약관","책임","면책","legal","contract","terms","liability","disclaimer"]],
    ["payment", ["결제","카드","정기결제","구독","환불","취소","pg","payment","card","subscription","refund","cancel","charge"]],
    ["business", ["기업","기관","제휴","입점","계약","business","partnership","enterprise","organization","vendor onboarding"]],
    ["bug", ["오류","에러","안 열","안됨","깨짐","버그","실패","접속 불가","error","bug","fail","broken","not working","cannot open"]],
    ["download", ["다운로드","설치","apk","exe","플레이어","download","install","installer","player"]],
    ["access", ["승급","권한","관리자","소유자","admin","permission","upgrade","owner access"]],
    ["membership", ["회원가입","가입","회원 등록","계정 이메일","이메일 인증","비밀번호","로그인 방법","sign up","signup","register","registration","account email","email verification","password","login method"]],
    ["commerce", ["상품","구매","판매자","배송","거래","주문","마켓","marketplace","product","purchase","seller","buyer","delivery","shipping","order","transaction"]]
  ];
  for (const [key, words] of rules){ if (includesAny(t, words)){ category = key; break; } }

  const configured = Array.isArray(k.adminRequiredCategories) ? k.adminRequiredCategories : [];
  let adminRequired = configured.includes(category) || includesAny(t, k.adminRequiredKeywords || []);
  const questionLength = q.trim().length;
  if (questionLength > 500) adminRequired = true;
  if (category === "membership" && includesAny(t, ["오류","에러","인증 안","이메일 변경","계정 삭제","도용","error","cannot","change email","delete account","hacked"])) adminRequired = true;
  if (category === "commerce" && includesAny(t, ["분쟁","환불","사기","손해","법적","책임","배송 문제","dispute","refund","fraud","damage","legal","liability"])) adminRequired = true;

  let priority = "normal";
  if (["security","legal"].includes(category)) priority = "urgent";
  else if (["payment","business","access","bug"].includes(category)) priority = "high";
  else if (adminRequired) priority = "high";
  else if (["download","membership","commerce"].includes(category)) priority = "normal";
  else priority = "low";
  if (includesAny(t, ["긴급","급함","즉시","urgent","emergency","critical"])) priority = "urgent";

  return { category, priority, admin_required: !!adminRequired, status: adminRequired ? "pending" : "answered", ai_answered: true, confidence: category === "general" ? 0.62 : 0.8 };
}

async function answerFor(question, meta, route, k, allowOpenAi){
  const lang = normalizeLang((meta && meta.lang) || "ko");
  const pack = QA_I18N[lang] || QA_I18N.en;
  const bodies = pack.b || QA_I18N.en.b;
  let body;
  if (route.category === "membership") body = bodies.membership;
  else if (route.category === "access") body = bodies.access;
  else if (route.category === "payment") body = bodies.payment;
  else if (route.category === "download") body = bodies.download;
  else if (route.category === "commerce") body = bodies.commerce;
  else if (route.category === "bug") body = bodies.bug;
  else if (route.category === "business") body = bodies.business;
  else if (route.category === "legal" || route.category === "security") body = bodies.legalSecurity;
  else body = bodies.general;

  const adminNote = route.admin_required ? pack.admin : pack.done;
  const fallback = [pack.hello, pack.intro, "", body, "", adminNote, "", pack.thanks].join("\n");
  const ai = allowOpenAi === true ? await openAiAnswer(question, meta, route, k, fallback) : null;
  return { answer: ai || fallback, ai_used: !!ai, fallback_used: !ai };
}

async function openAiAnswer(question, meta, route, k, fallbackAnswer){
  if (!OPENAI_API_KEY) return null;
  const lang = normalizeLang((meta && meta.lang) || "ko");
  const languageName = LANG_NAMES[lang] || "English";
  const g = (k && k.publicGuidance) || {};
  const policy = (k && k.aiAnswerPolicy) || {};
  const platform = (k && k.platform) || {};
  const system = [
    `You are the first-line AI support assistant for ${platform.name || "IGDC Global Hub"}.`,
    `Write in ${languageName}. Use a polite email-style support response.`,
    `Use only the provided platform guidance. Do not invent approvals, guarantees, legal conclusions, refund decisions, payment confirmations, admin permissions, private paths, bank details, or internal engine details.`,
    `If the question requires account verification, payment/refund/cancellation decision, legal/security/privacy review, business contract, product dispute, or admin permission, say it has been routed for admin review.`,
    `Keep the answer concise: greeting, guidance, next step, closing.`
  ].join("\n");
  const guidance = {
    upgrade: g.upgrade,
    qna: g.qna,
    registration: g.registration,
    accountEmail: g.accountEmail,
    downloads: g.downloads,
    payment: g.payment,
    memberOnly: g.memberOnly,
    admin: g.admin,
    commerceDisclaimer: g.commerceDisclaimer,
    email: g.email,
    safeFallback: policy.safeFallback
  };
  const user = JSON.stringify({
    question: String(question || "").slice(0,1600),
    category: route.category,
    priority: route.priority,
    admin_required: route.admin_required,
    language: lang,
    source: meta && meta.source,
    page: meta && meta.page,
    platform_guidance: guidance,
    fallback_template: fallbackAnswer
  }, null, 2);
  try{
    const res = await fetchCompat("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + OPENAI_API_KEY },
      body:JSON.stringify({
        model: OPENAI_MODEL,
        temperature:0.2,
        max_tokens:520,
        messages:[ { role:"system", content:system }, { role:"user", content:user } ]
      })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text.slice(0,220));
    const data = JSON.parse(text);
    const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return out ? String(out).trim() : null;
  }catch(e){
    return null;
  }
}

function adminSummary(question, route){
  return {
    q: s(question).replace(/\s+/g," ").trim().slice(0,180),
    category: route.category,
    priority: route.priority,
    status: route.status,
    admin_required: route.admin_required
  };
}

function sbHeaders(service, userToken){
  const useService = !!(service && SUPABASE_SERVICE_ROLE_KEY);
  const key = useService ? SUPABASE_SERVICE_ROLE_KEY : (SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY);
  const authorization = useService ? SUPABASE_SERVICE_ROLE_KEY : (cleanText(userToken, 10000) || key);
  return {
    apikey: key,
    Authorization: `Bearer ${authorization}`,
    "Content-Type":"application/json",
    Prefer:"return=representation"
  };
}

async function sbFetch(restPath, init, service, userToken){
  if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) throw new Error("Supabase env missing");
  const url = `${SUPABASE_URL.replace(/\/$/,"")}/rest/v1/${restPath}`;
  const res = await fetchCompat(url, Object.assign({}, init || {}, { headers:Object.assign(sbHeaders(service, userToken), (init && init.headers) || {}) }));
  const text = await res.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch(e){ data = text; }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return data;
}

function cleanText(v, max){
  return s(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 2000);
}

function normalizeScope(raw, fallback, max){
  const value = cleanText(raw, max || 300);
  return value || fallback;
}

function scopeFor(record){
  const meta = record && record.meta || {};
  return {
    project: normalizeScope(record && (record.project || record.project_id) || meta.project, "IGDC", 120),
    page_id: normalizeScope(record && (record.page_id || record.pageId) || meta.page_id || meta.pageId || meta.page, "", 360)
  };
}

function isSavedThread(saved){
  return !!(saved && Array.isArray(saved.threads) && saved.threads.length);
}

function canDeleteThread(row, identity){
  identity = identity || {};
  const meta = row && row.meta || {};
  const rowUserId = cleanText(row && row.user_id || meta.user_id, 300);
  const rowMemberUserId = cleanText(meta.member_user_id || meta.memberUserId, 300);
  if (identity.isAdmin) return true;
  if (identity.supabaseUserId && rowUserId && identity.supabaseUserId === rowUserId) return true;
  if (identity.memberUserId && rowMemberUserId && identity.memberUserId === rowMemberUserId) return true;
  return false;
}

function publicThread(row, identity){
  const meta = row && row.meta || {};
  return {
    id: row && (row.id || row.uuid || row.ts) || null,
    project: row && row.project || meta.project || "IGDC",
    page_id: row && (row.page_id || row.pageId) || meta.page_id || meta.pageId || meta.page || "",
    question: row && (row.question || row.q) || "",
    answer: row && (row.answer || row.a) || "",
    is_admin: !!(row && (row.is_admin || row.admin_required) || meta.admin_required),
    status: row && row.status || meta.status || "answered",
    created_at: row && (row.created_at || row.updated_at || row.ts) || null,
    can_delete: canDeleteThread(row, identity)
  };
}

async function saveQuestion(record, dbToken){
  const saved = { questions:null, threads:null, persisted:false, errors:[], warnings:[] };
  if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) {
    saved.errors.push("Supabase env missing; answer generated without DB save.");
    return saved;
  }

  const scope = scopeFor(record);
  if (!scope.page_id) {
    saved.errors.push("Missing page_id; Q&A thread was not saved.");
    return saved;
  }

  const meta = Object.assign({}, record.meta || {}, {
    project: scope.project,
    page_id: scope.page_id,
    qa_proxy_version: VERSION,
    category: record.category,
    priority: record.priority,
    admin_required: !!record.admin_required,
    status: record.status,
    ai_answered: record.ai_answered,
    answer_hash: hash(record.answer),
    user_id: cleanText(record.user_id, 300) || null,
    member_user_id: cleanText(record.member_user_id, 300) || null
  });

  // This is the canonical row read by the existing popup's registered-question list.
  // Keep the first write restricted to the fields already used by the current popup schema.
  const canonicalThread = [{
    project: scope.project,
    page_id: scope.page_id,
    user_id: cleanText(record.user_id, 300) || null,
    question: record.question,
    answer: record.answer,
    is_admin: !!record.admin_required,
    created_at: record.created_at,
    meta
  }];
  try{
    saved.threads = await sbFetch("igdc_qna_threads", { method:"POST", body:JSON.stringify(canonicalThread) }, true, dbToken);
  }catch(e1){
    // Some older deployments do not yet have a JSON meta column. Preserve saving with the core popup fields.
    const compatThread = [{
      project: scope.project,
      page_id: scope.page_id,
      user_id: cleanText(record.user_id, 300) || null,
      question: record.question,
      answer: record.answer,
      is_admin: !!record.admin_required,
      created_at: record.created_at
    }];
    try{ saved.threads = await sbFetch("igdc_qna_threads", { method:"POST", body:JSON.stringify(compatThread) }, true, dbToken); }
    catch(e2){ saved.errors.push(`igdc_qna_threads save failed: ${e2.message || e2}`); }
  }
  saved.persisted = isSavedThread(saved);
  if (!saved.persisted) return saved;

  // Preserve the legacy audit/mirror table when it exists, but do not let mirror failure pretend that the popup save failed.
  const richQuestion = [{
    question: record.question,
    answer: record.answer,
    category: record.category,
    priority: record.priority,
    admin_required: !!record.admin_required,
    status: record.status,
    meta,
    created_at: record.created_at
  }];
  const simpleQuestion = [{ question: record.question, meta }];
  try{ saved.questions = await sbFetch("questions", { method:"POST", body:JSON.stringify(richQuestion) }, true, dbToken); }
  catch(e1){
    try{ saved.questions = await sbFetch("questions", { method:"POST", body:JSON.stringify(simpleQuestion) }, true, dbToken); }
    catch(e2){ saved.warnings.push(`questions mirror save skipped: ${e2.message || e2}`); }
  }
  return saved;
}

async function listPublicThreads(project, pageId, limit, identity, dbToken){
  limit = Math.max(1, Math.min(100, safeNum(limit, 100)));
  const result = { ok:true, version:VERSION, project, page_id:pageId, limit, rows:[], warnings:[] };
  if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) {
    result.ok = false;
    result.warnings.push("Supabase env missing");
    return result;
  }
  if (!pageId) {
    result.ok = false;
    result.warnings.push("Missing page_id");
    return result;
  }
  const p = encodeURIComponent(project);
  const id = encodeURIComponent(pageId);
  try{
    const rows = await sbFetch(`igdc_qna_threads?select=*&project=eq.${p}&page_id=eq.${id}&order=created_at.desc&limit=${limit}`, { method:"GET", headers:{ Prefer:"" } }, true, dbToken);
    result.rows = (Array.isArray(rows) ? rows : []).map(row => publicThread(row, identity)).filter(x => x.question);
  }catch(e){
    result.ok = false;
    result.warnings.push(String(e.message || e).slice(0,280));
  }
  return result;
}

async function deletePublicThread(payload, identity, dbToken){
  identity = identity || {};
  const id = cleanText(payload && payload.id, 240);
  const project = normalizeScope(payload && payload.project, "IGDC", 120);
  const pageId = normalizeScope(payload && (payload.page_id || payload.pageId || payload.page), "", 360);
  if (!id) return { ok:false, statusCode:400, error:"Missing id" };
  if (!identity.isAdmin && !identity.supabaseUserId && !identity.memberUserId) {
    return { ok:false, statusCode:401, error:"A valid question author or administrator session is required." };
  }
  try{
    const rows = await sbFetch(`igdc_qna_threads?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, { method:"GET", headers:{ Prefer:"" } }, true, dbToken);
    const row = Array.isArray(rows) && rows[0];
    if (!row) return { ok:false, statusCode:404, error:"Question not found" };
    const rowScope = scopeFor(row);
    if (pageId && rowScope.page_id !== pageId) return { ok:false, statusCode:403, error:"Question scope mismatch" };
    if (project && rowScope.project !== project) return { ok:false, statusCode:403, error:"Question scope mismatch" };
    if (!canDeleteThread(row, identity)) return { ok:false, statusCode:403, error:"Only the author or an administrator can delete this question." };
    const deleted = await sbFetch(`igdc_qna_threads?id=eq.${encodeURIComponent(id)}`, { method:"DELETE" }, true, dbToken);
    if (!Array.isArray(deleted) || !deleted.length) {
      return { ok:false, statusCode:403, error:"The question could not be deleted under the current database policy." };
    }
    return { ok:true, version:VERSION, id, deleted:true };
  }catch(e){
    return { ok:false, statusCode:503, error:String(e.message || e).slice(0,360) };
  }
}

function normalizeRows(rows, source){
  return (Array.isArray(rows) ? rows : []).map((x, idx) => {
    const meta = x.meta || {};
    const created = x.created_at || x.updated_at || x.ts || null;
    return {
      id: x.id || x.uuid || x.ts || `${source}-${idx}`,
      table: source,
      ts: created ? Date.parse(created) || created : Date.now() - idx,
      created_at: created,
      q: x.q || x.question || meta.question || "",
      a: x.a || x.answer || meta.answer || "",
      category: x.category || meta.category || "general",
      priority: x.priority || meta.priority || "normal",
      status: x.status || meta.status || "pending",
      important: !!(x.important || meta.important || ["high","urgent"].includes(x.priority || meta.priority)),
      admin_required: !!(x.admin_required || x.is_admin || meta.admin_required),
      source: x.source || meta.source || source,
      meta
    };
  }).filter(x => x.q);
}

async function listAdminQuestions(limit){
  limit = Math.max(1, Math.min(100, safeNum(limit, 50)));
  const result = { ok:true, version:VERSION, admin_required_only:true, limit, rows:[], sources:[], warnings:[] };
  if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) {
    result.ok = false;
    result.warnings.push("Supabase env missing");
    return result;
  }

  const paths = [
    { table:"igdc_qna_threads", path:`igdc_qna_threads?select=*&order=created_at.desc&limit=${Math.min(limit * 4, 400)}` },
    { table:"questions", path:`questions?select=*&order=created_at.desc&limit=${Math.min(limit * 4, 400)}` }
  ];
  for (const p of paths){
    try{
      const rows = await sbFetch(p.path, { method:"GET", headers:{ Prefer:"" } }, true);
      const norm = normalizeRows(rows, p.table).filter(x => !!(x.meta && x.meta.admin_required) || x.admin_required || x.important);
      result.sources.push({ table:p.table, ok:true, count:norm.length });
      result.rows.push(...norm);
    }catch(e){
      result.sources.push({ table:p.table, ok:false, error:String(e.message || e).slice(0,220) });
    }
  }

  const seen = new Set();
  result.rows = result.rows
    .filter(x => {
      const key = `${x.table}:${x.id}:${hash(x.q)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a,b) => (Number(b.ts)||0) - (Number(a.ts)||0))
    .slice(0, limit);
  return result;
}

async function updateAdminQuestion(payload){
  const table = ["igdc_qna_threads","questions"].includes(payload.table) ? payload.table : "igdc_qna_threads";
  const id = payload.id;
  if (!id) return { ok:false, error:"missing id" };
  const patch = {};
  if (payload.status) patch.status = payload.status;
  if (payload.admin_answer != null || payload.answer != null) patch.answer = s(payload.admin_answer != null ? payload.admin_answer : payload.answer);
  if (payload.important != null) patch.important = !!payload.important;
  patch.updated_at = nowIso();
  try{
    const encoded = encodeURIComponent(String(id));
    const data = await sbFetch(`${table}?id=eq.${encoded}`, { method:"PATCH", body:JSON.stringify(patch) }, true);
    return { ok:true, table, updated:data };
  }catch(e){ return { ok:false, table, error:String(e.message || e) }; }
}

exports.handler = async function(event){
  try{
    const method = String(event.httpMethod || "GET").toUpperCase();
    if (method === "OPTIONS") return { statusCode:204, headers:CORS, body:"" };

    const qs = event.queryStringParameters || {};
    const action = low(qs.action || qs.mode || "");
    if (method === "GET") {
      if (action === "list" || action === "threads" || action === "thread-list") {
        const project = normalizeScope(qs.project, "IGDC", 120);
        const pageId = normalizeScope(qs.page_id || qs.pageId || qs.page, "", 360);
        const identity = await requestIdentity(event);
        const listed = await listPublicThreads(project, pageId, qs.limit, identity, identity.dbToken);
        return json(listed.ok ? 200 : 503, listed);
      }
      // No deployed client currently uses the legacy admin endpoints. Keep their surface closed
      // until the admin UI passes a verified server-side session token.
      if (low(qs.admin || qs.mode || qs.action) === "1" || low(qs.admin || qs.mode || qs.action) === "admin" || action === "admin-list") {
        return json(403, { ok:false, version:VERSION, error:"Admin Q&A access requires a verified server-side admin session." });
      }
      if (action === "health") {
        const k = readKnowledge();
        return json(200, { ok:true, version:VERSION, knowledge:{ version:k.version, hash:k._hash || null }, supabase:!!SUPABASE_URL });
      }
      // Backward-compatible FAQ fetch.
      try{
        const faqs = await sbFetch("faqs?select=question,answer,updated_at&order=updated_at.desc&limit=20", { method:"GET", headers:{ Prefer:"" } }, false);
        return json(200, { ok:true, version:VERSION, faqs });
      }catch(e){
        return json(200, { ok:true, version:VERSION, faqs:[], warning:String(e.message || e) });
      }
    }

    if (method === "POST") {
      if (!qaRateAllowed(event)) return json(429, { ok:false, version:VERSION, error:"rate_limited" });
      const rawBytes = Buffer.byteLength(String(event.body || ""), event.isBase64Encoded ? "base64" : "utf8");
      if (rawBytes > 64 * 1024) return json(413, { ok:false, version:VERSION, error:"request_too_large" });
      const body = parseBody(event);
      const identity = await requestIdentity(event);
      if (low(body.action) === "delete") {
        const removed = await deletePublicThread(body, identity, identity.dbToken);
        return json(removed.ok ? 200 : (removed.statusCode || 403), removed);
      }
      if (low(body.action) === "admin-update") {
        return json(403, { ok:false, version:VERSION, error:"Admin Q&A updates require a verified server-side admin session." });
      }

      const question = cleanText(body.question || body.q || body.message, 4000);
      if (!question) return json(400, { ok:false, error:"Missing question" });
      const incomingMeta = body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? body.meta : {};
      const project = normalizeScope(body.project || body.project_id || incomingMeta.project, "IGDC", 120);
      const pageId = normalizeScope(body.page_id || body.pageId || body.page || incomingMeta.page_id || incomingMeta.pageId || incomingMeta.page, "", 360);
      if (!pageId) return json(400, { ok:false, error:"Missing page_id" });
      const meta = {
        lang: normalizeLang(body.lang || incomingMeta.lang || "ko"),
        project,
        page_id: pageId,
        page: pageId,
        source: cleanText(body.source || incomingMeta.source || "qna-popup", 120),
        ua: cleanText(incomingMeta.ua, 500),
        channel: cleanText(incomingMeta.channel, 120)
      };
      meta.member_user_id = identity.memberUserId || "";
      meta.author_kind = identity.memberUserId ? "member" : (identity.supabaseUserId ? "supabase-session" : "unverified");
      const k = readKnowledge();
      const route = classify(question, meta, k);
      // Every registered public Q&A attempts an AI first-line answer. The safe template
      // remains only as a resilience fallback when the AI key/provider is unavailable.
      const answerResult = await answerFor(question, meta, route, k, true);
      const answer = answerResult.answer;
      const answerMode = answerResult.ai_used ? "openai-firstline" : "safe-template-fallback";
      meta.answer_mode = answerMode;
      console.log("[qa-proxy]", "answer_mode=", answerMode, "category=", route.category);
      const record = Object.assign({
        project,
        page_id: pageId,
        user_id: identity.supabaseUserId || null,
        member_user_id: identity.memberUserId || null,
        question,
        answer,
        created_at: nowIso(),
        source: meta.source || "qa-proxy",
        meta
      }, route);
      const saved = await saveQuestion(record, identity.dbToken);
      const stored = isSavedThread(saved);
      const persistedRow = stored ? publicThread(saved.threads[0], identity) : null;
      return json(stored ? 200 : 503, {
        ok:stored,
        version:VERSION,
        answer,
        route,
        admin_required: route.admin_required,
        priority: route.priority,
        category: route.category,
        status: route.status,
        answer_mode: answerMode,
        saved,
        record:persistedRow,
        error: stored ? null : "Q&A answer was generated, but the question was not saved."
      });
    }

    return json(405, { ok:false, error:"Method not allowed" });
  }catch(e){
    return json(500, { ok:false, version:VERSION, error:String(e && e.message || e) });
  }
};
