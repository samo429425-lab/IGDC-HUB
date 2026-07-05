/* IGDC Member/Admin Modal v2.9.1-member-profile-upgrade
   6번 권한별 서비스 패널 + 7번 안정 트리거/호환 구조 통합본.
   - Trigger: #mo-btn, [data-member-modal="open"], .js-member-admin-modal-trigger, .js-seller-modal-trigger
   - Legacy compatibility: openModal('apply'), injectModal(), openMemberAdminModal()
   - Admin member list: server-only API endpoint required. Never exposes Auth0 M2M secret in browser.
   - Default API: /.netlify/functions/member-admin
*/
(function () {
  'use strict';

  if (window.IGDCMemberAdminModal && window.IGDCMemberAdminModal.__version) return;

  var VERSION = '2.9.1-member-profile-upgrade';
  var DEFAULT_API = '/.netlify/functions/member-admin';
  var ROOT_ID = 'igdc-member-admin-root';
  var STYLE_ID = 'igdc-member-admin-style-v2';

  var STATE = {
    opened: false,
    tab: 'member-home',
    me: null,
    members: [],
    notices: [],
    questions: [],
    adminQuestions: [],
    reviewDocs: [],
    myReviewDocs: [],
    loadingReview: false,
    loadingMyReview: false,
    loadingQuestions: false,
    loadingAdminQuestions: false,
    loadingNotices: false,
    diagnosticReport: null,
    loadingDiagnostic: false,
    loading: false,
    error: '',
    query: '',
    page: 0,
    total: 0,
    hasMore: false,
    lastFocus: null,
    requestedRole: '',
    memberProfile: null,
    loadingMemberProfile: false,
    savingMemberProfile: false,
    profileMessage: ''
  };

  var ROLE_LEVEL = {
    guest: 0,
    member: 1,
    member_standard: 2,
    member_premium: 3,
    special_menber: 4,
    special_member: 4,
    commerce_manager: 5,
    site_manager: 12,
    site_manager_home_om: 10,
    site_manager_home_op: 11,
    site_manager_home: 12,
    site_manager_distribution_om: 10,
    site_manager_distribution_op: 11,
    site_manager_distribution: 12,
    site_manager_donation_om: 10,
    site_manager_donation_op: 11,
    site_manager_donation: 12,
    site_manager_mediahub_om: 10,
    site_manager_mediahub_op: 11,
    site_manager_mediahub: 12,
    site_manager_networkhub_om: 10,
    site_manager_networkhub_op: 11,
    site_manager_networkhub: 12,
    site_manager_socialnetwork_om: 10,
    site_manager_socialnetwork_op: 11,
    site_manager_socialnetwork: 12,
    site_manager_tour_om: 10,
    site_manager_tour_op: 11,
    site_manager_tour: 12,
    coordinator_director: 13,
    site_manager_director: 14,
    director: 15,
    admin: 20,
    super_admin: 25,
    owner: 30
  };

  var LABELS = {
    ko: {
      title: '🔒 회원전용',
      desc: '로그인 권한에 따라 회원 서비스와 관리자 관리 기능이 열립니다.',
      login: 'OS-Login',
      renew: '세션 갱신',
      close: '닫기',
      refresh: '새로고침',
      openPage: '전용 페이지 열기',
      memberPage: '회원 페이지',
      adminPage: '관리 페이지',
      loading: '불러오는 중입니다.',
      noAccess: '관리자 권한이 필요한 영역입니다.',
      apiMissing: '회원 관리 API가 연결되지 않았습니다.',
      searchPlaceholder: '이름, 이메일, user_id 검색',
      tabs: {
        memberHome: '회원 홈',
        memberPage: '회원 페이지',
        submit: '서류 제출',
        question: '질문/문의',
        notice: '공지사항',
        adminMembers: '회원 목록',
        adminQueue: '승급 검토',
        adminNotice: '답글/공지 관리',
        adminDiagnostic: '시스템 점검'
      }
    },
    en: {
      title: '🔒 Members Only',
      desc: 'Member services and admin tools open according to the signed-in role.',
      login: 'OS-Login',
      renew: 'Renew session',
      close: 'Close',
      refresh: 'Refresh',
      openPage: 'Open private page',
      memberPage: 'Member page',
      adminPage: 'Admin page',
      loading: 'Loading.',
      noAccess: 'Admin permission is required.',
      apiMissing: 'Member admin API is not connected.',
      searchPlaceholder: 'Search name, email, or user_id',
      tabs: {
        memberHome: 'Member Home',
        memberPage: 'Member Page',
        submit: 'Documents',
        question: 'Questions',
        notice: 'Notices',
        adminMembers: 'Members',
        adminQueue: 'Review Documents',
        adminNotice: 'Replies/Notices',
        adminDiagnostic: 'System Diagnostic'
      }
    }
  };

  function cfg() {
    return window.IGDC_MEMBER_ADMIN_CONFIG || {};
  }
  function apiBase() {
    return String(cfg().apiBase || DEFAULT_API);
  }
  function lang() {
    try {
      var raw = String(document.documentElement.getAttribute('lang') || localStorage.getItem('igdc_lang') || navigator.language || 'en').trim().toLowerCase().replace(/_/g, '-');
      var aliases = {
        'ko-kr':'ko','en-us':'en','en-gb':'en','zh-cn':'zh','zh-sg':'zh',
        'zh-tw':'zht','zh-hk':'zht','zh-mo':'zht','zh-hant':'zht','zh-hans':'zh',
        'pt-br':'pt','pt-pt':'pt','fil':'tl'
      };
      if (aliases[raw]) return aliases[raw];
      var base = raw.split('-')[0];
      return ['ko','en','zh','zht','ja','es','fr','de','ru','pt','it','ar','vi','th','id','hi','tr','fa','bn','ur','sw','ta','hu','ms','nl','pl','sv','tl','uk','uz'].indexOf(base) >= 0 ? base : 'en';
    } catch (e) {}
    return 'en';
  }
  function isRtlLanguage(code) { return code === 'ar' || code === 'fa' || code === 'ur'; }
  function t() { return LABELS[lang()] || LABELS.en; }

  var UI_TEXT = {
    ko: {
      memberStatusTitle:'회원 상태', currentRole:'현재 역할', memberStatusDesc:'일반 회원은 미디어 콘텐츠 구매/열람 중심으로 사용합니다.',
      premiumTitle:'프리미엄 회원', premiumDesc:'프리미엄 회원은 우수 고객 로열티 혜택 기준으로 OSO/M2M이 별도로 부여합니다.', premiumApply:'프리미엄 안내',
      commerceTitle:'커머스/상위 권한', commerceDesc:'상품·커머스·상위 롤은 관리자 검토 후 부여합니다.', commerceApply:'커머스 신청',
      standardTitle:'스탠다드 회원', standardDesc:'필수 회원정보를 완료하면 OSO/M2M이 자동으로 정회원 여부를 판정합니다.', standardApply:'승급 요청',
      memberPageTitle:'회원 페이지', memberPageDesc:'전용 문서, 문의, 제출 상태를 확인합니다.', openMemberPage:'회원 페이지 열기',
      adminMembersTitle:'관리자 회원 목록', adminMembersDesc:'실제 Auth0 세션으로 권한 범위의 회원 목록을 불러오고 롤을 관리합니다.', openMembers:'회원 목록 열기', openReview:'승급 검토 열기',
      loginStateTitle:'로그인 상태', siteRole:'사이트 역할 표시', tokenOk:'Auth0 ID 토큰이 정상 연결되어 있습니다.', tokenMissing:'역할 표시는 있으나 Auth0 ID 토큰이 없거나 만료되었습니다. 회원 목록 조회는 세션 갱신 후 가능합니다.', renewSession:'세션 갱신',
      loginTitle:'로그인', loginDesc:'회원전용 영역은 로그인 후 사용할 수 있습니다.',
      submitTitle:'서류 제출', submitDesc:'제출한 내용과 첨부 자료는 비공개 심사 보관함에 저장되며, 권한 있는 관리자만 검토할 수 있습니다.', titleLabel:'제목', submitTitlePlaceholder:'제출 제목', bodyLabel:'내용', submitBodyPlaceholder:'제출 내용', requestedRoleLabel:'신청 등급', requestedRoleNone:'일반 서류 제출', requestedRoleStandard:'스탠다드 회원', requestedRolePremium:'프리미엄 회원', requestedRoleCommerce:'커머스 회원', attachmentLabel:'첨부 서류', attachmentHelp:'파일은 비공개 심사 보관함에 저장됩니다.', submitButton:'제출', documentSaved:'제출 자료가 심사 대기열에 저장되었습니다.', documentUploadFailed:'내용은 저장되었지만 첨부 파일 전송이 완료되지 않았습니다. 서류 제출 화면에서 다시 제출해 주세요.', roleSourceReview:'승급 심사 승인', reviewNotePrompt:'검토 메모를 입력하십시오. 비워 두어도 됩니다.',
      questionTitle:'질문/문의', questionDesc:'질문·문의는 본인과 권한 범위 안의 관리자만 열람할 수 있습니다. 답글이 등록되면 이 화면에서 확인할 수 있습니다.', qTitleLabel:'질문 제목', qTitlePlaceholder:'질문 제목', qBodyLabel:'질문 내용', qBodyPlaceholder:'질문 내용', qButton:'질문 등록', openReplyAdmin:'답글 관리 열기', myQuestionsTitle:'내 질문·문의', myQuestionsDesc:'본인이 제출한 질문과 관리자 답글만 표시됩니다.', myQuestionsReload:'내 문의 새로고침', myQuestionsNone:'등록한 질문·문의가 없습니다.', questionStatusOpen:'접수', questionStatusAnswered:'답변 완료', questionStatusClosed:'종료', repliesTitle:'관리자 답글', noReplies:'아직 등록된 답글이 없습니다.',
      noticeTitle:'공지사항', noticeDesc:'등록된 공지는 로그인한 회원에게 표시됩니다.', manageNotice:'공지 작성/답글 관리', noticesReload:'공지 새로고침', noticesNone:'등록된 공지가 없습니다.', publishedAt:'등록일',
      adminQuestionsTitle:'회원 질문·문의 답글', adminQuestionsDesc:'현재 권한 범위 안의 회원 질문만 표시됩니다. 일반·커머스 공통회원의 문의는 사이트 매니저에게 열리지 않으며, owner/admin과 권한 범위의 상위 관리자만 처리합니다.', adminQuestionsReload:'문의 새로고침', adminQuestionsNone:'현재 권한으로 처리할 질문·문의가 없습니다.', replyLabel:'답글', replyPlaceholder:'회원에게 표시될 답글을 입력하십시오.', replyButton:'답글 등록', noticePublishTitle:'공지 등록', noticePublishDesc:'공지는 모든 로그인 회원에게 표시됩니다. 공지 등록은 owner와 admin 계열만 할 수 있습니다.', noticeTitleLabel:'공지 제목', noticeTitlePlaceholder:'공지 제목', noticeBodyLabel:'공지 내용', noticeBodyPlaceholder:'공지 내용', publishButton:'공지 등록', noticePublishDenied:'공지 등록 권한은 owner와 admin 계열만 갖습니다.',
      noPermission:'권한 없음', viewOnly:'조회 전용', save:'예외 적용', restoreOsO:'OSO 기준 복귀', block:'차단 검토', unblock:'차단 해제', protectedAccount:'보호 계정', selectSpecialRole:'특수 역할 선택', roleReasonPrompt:'예외 역할 적용 사유를 입력하십시오.', restoreReasonPrompt:'OSO 자동 역할 기준으로 복귀시키는 사유를 입력하십시오.', blockReasonPrompt:'차단 사유를 입력하십시오.', unblockReasonPrompt:'차단 해제 사유를 입력하십시오.', roleSourceOsO:'OSO/M2M 원본', roleSourceManual:'관리자 예외 적용', roleSourceReturned:'OSO 변경 반영', confirmProtectedBlockPrefix:'보호 계정입니다. 아래 확인 문구를 정확히 입력하십시오:\n', adminMembersTitle2:'OSO/Auth0 회원 목록', adminMembersDesc2:'일반·스탠다드·프리미엄·특수·커머스는 공통회원으로 조회만 표시됩니다. 사이트 매니저는 자기 사이트의 OM·OP만 관리할 수 있고, OM·OP도 자기보다 낮은 같은 사이트 OM·OP만 관리할 수 있습니다. 다른 사이트 운영회원 정보와 서류는 열리지 않습니다. director는 하위 사이트 매니저와 그 아래 전체, admin은 owner를 제외한 전체, owner는 전체를 관리합니다.', search:'검색', colMember:'회원', colRole:'적용 역할 / OSO 원본', colChangeReview:'특수 역할 조정', colManage:'관리', noMembers:'관리 권한으로 볼 수 있는 회원이 없거나 API 연결 대기 중입니다.', shown:'표시', serverQuery:'서버 조회', page:'페이지', previous:'이전', next:'다음',
      reviewDocDefault:'제출 서류', open:'열람', detail:'상세', approve:'승인', reject:'반려', reviewTitle:'승급 검토', reviewRefresh:'새로고침', reviewDesc:'회원이 제출한 서류와 승급·권한 신청 자료를 검토하는 영역입니다. 일반 회원은 본인 자료만 회원 페이지에서 확인합니다. 사이트 매니저는 자기 사이트 OM·OP만, OM·OP는 자기보다 낮은 같은 사이트 OM·OP만 검토할 수 있습니다. director/site_manager_director는 하위 사이트 매니저와 그 아래 전체, admin은 owner 제외 전체, owner는 전체를 검토합니다.', reviewHeadDoc:'제출 서류', reviewHeadMember:'회원', reviewHeadTarget:'요청 롤', reviewHeadStatus:'상태', reviewHeadReview:'검토', noReviewDocs:'현재 권한으로 볼 수 있는 제출 서류가 없거나, 서류 검토 API 연결 대기 중입니다.', shownItems:'표시', serverItems:'서버 조회',
      adminNoticeTitle:'답글/공지 관리', adminNoticeDesc:'관리자 권한에서만 답글 작성·공지 등록 버튼이 활성화됩니다.', targetTitleLabel:'대상/제목', targetTitlePlaceholder:'공지 제목 또는 답글 대상', adminNoticeBodyLabel:'내용', adminNoticeBodyPlaceholder:'공지 또는 답글 내용', register:'등록',
      registered:'등록되었습니다.', reviewTokenMissing:'사이트 역할은 확인되지만 Auth0 ID 토큰이 모달/API에 연결되지 않았습니다. 상단의 세션 갱신 후 승급 검토를 다시 열어야 합니다.', reviewApiMissing:'서류 검토 API 연결이 필요합니다.', noAttachment:'열람 가능한 첨부 URL이 없습니다.', confirmProcess:'처리할까요?', memberTokenMissing:'사이트 역할은 확인되지만 Auth0 ID 토큰이 모달/API에 연결되지 않았습니다. 상단의 세션 갱신 후 회원 목록을 다시 열어야 합니다.', tokenExpiredSuffix:' / 현재 로그인 세션 토큰이 만료되었거나 없습니다.', changeNoPerm:'현재 권한으로는 해당 롤로 변경할 수 없습니다.', confirmRoleChangePrefix:'회원 롤을 ', confirmRoleChangeSuffix:' 로 변경할까요?', confirmBlock:'이 회원을 차단/퇴출 처리할까요?', upgradeRequested:'신청되었습니다.', myReviewTitle:'내 신청·서류 현황', myReviewDesc:'본인이 제출한 신청과 서류의 처리 상태만 확인할 수 있습니다.', myReviewNone:'제출한 신청 또는 서류가 없습니다.', myReviewOpen:'내 제출 자료 열기', myReviewReload:'내 현황 새로고침', diagnosticTitle:'Supabase 심사 보관함 시스템 점검', diagnosticDesc:'이 점검은 서버에서 심사 테이블·필수 사이트 소속 열·비공개 파일 보관함·서비스 역할 연결을 읽기 전용으로 확인합니다. 회원 정보, 제출 서류, 서명 URL, 비밀키는 JSON에 포함되지 않습니다.', diagnosticRun:'지금 점검', diagnosticDownload:'JSON 다운로드', diagnosticWaiting:'점검 중입니다.', diagnosticEmpty:'아직 점검 결과가 없습니다.', diagnosticNotAllowed:'시스템 점검은 owner와 admin 계열만 사용할 수 있습니다.', diagnosticReadOnly:'점검은 읽기 전용이며 운영 DB에 시험 자료를 만들거나 수정하지 않습니다.'
    },
    en: {
      memberStatusTitle:'Member Status', currentRole:'Current role', memberStatusDesc:'General members use this area mainly for media content purchases and viewing.',
      premiumTitle:'Premium Member', premiumDesc:'Premium membership is assigned separately by OSO/M2M under excellent-customer loyalty criteria.', premiumApply:'Premium information',
      commerceTitle:'Commerce / Higher Permissions', commerceDesc:'Product, commerce, and higher roles are assigned after administrator review.', commerceApply:'Apply for Commerce',
      standardTitle:'Standard Member', standardDesc:'After required member information is complete, OSO/M2M automatically evaluates Standard membership.', standardApply:'Upgrade Request',
      memberPageTitle:'Member Page', memberPageDesc:'Check private documents, inquiries, and submission status.', openMemberPage:'Open Member Page',
      adminMembersTitle:'Admin Member List', adminMembersDesc:'Load and manage the permitted Auth0 member scope through a real signed-in session.', openMembers:'Open Member List', openReview:'Open Review Queue',
      loginStateTitle:'Login Status', siteRole:'Site role', tokenOk:'The Auth0 ID token is connected correctly.', tokenMissing:'A site role is visible, but the Auth0 ID token is missing or expired. Renew the session before viewing the member list.', renewSession:'Renew session',
      loginTitle:'Login', loginDesc:'Members-only areas are available after login.',
      submitTitle:'Document Submission', submitDesc:'Submitted content and attachments are kept in a private review store and are available only to authorized reviewers.', titleLabel:'Title', submitTitlePlaceholder:'Submission title', bodyLabel:'Content', submitBodyPlaceholder:'Submission content', requestedRoleLabel:'Requested membership', requestedRoleNone:'General document submission', requestedRoleStandard:'Standard member', requestedRolePremium:'Premium member', requestedRoleCommerce:'Commerce member', attachmentLabel:'Supporting files', attachmentHelp:'Files are stored in the private review vault.', submitButton:'Submit', documentSaved:'The submission has been stored in the review queue.', documentUploadFailed:'Your content was saved, but attachment upload did not finish. Submit the documents again from this page.', roleSourceReview:'Membership review approved', reviewNotePrompt:'Enter a review note. It may be left blank.',
      questionTitle:'Questions / Inquiry', questionDesc:'Questions are visible only to the member who submitted them and administrators within the permitted scope. Replies appear here after they are registered.', qTitleLabel:'Question title', qTitlePlaceholder:'Question title', qBodyLabel:'Question content', qBodyPlaceholder:'Question content', qButton:'Submit Question', openReplyAdmin:'Open Reply Management', myQuestionsTitle:'My Questions / Inquiries', myQuestionsDesc:'Only your submitted questions and administrator replies are shown.', myQuestionsReload:'Refresh My Inquiries', myQuestionsNone:'There are no submitted questions or inquiries.', questionStatusOpen:'Received', questionStatusAnswered:'Answered', questionStatusClosed:'Closed', repliesTitle:'Administrator Replies', noReplies:'No reply has been registered yet.',
      noticeTitle:'Notices', noticeDesc:'Published notices are shown to signed-in members.', manageNotice:'Create Notice / Manage Replies', noticesReload:'Refresh Notices', noticesNone:'There are no published notices.', publishedAt:'Published',
      adminQuestionsTitle:'Member Questions / Replies', adminQuestionsDesc:'Only questions inside the current management scope are shown. Global consumer-member inquiries are not visible to site managers; they are handled only by owner/admin and permitted upper managers.', adminQuestionsReload:'Refresh Questions', adminQuestionsNone:'No member questions are available in the current scope.', replyLabel:'Reply', replyPlaceholder:'Enter the reply that will be shown to the member.', replyButton:'Post Reply', noticePublishTitle:'Publish Notice', noticePublishDesc:'Published notices are shown to all signed-in members. Publishing is limited to owner and admin roles.', noticeTitleLabel:'Notice title', noticeTitlePlaceholder:'Notice title', noticeBodyLabel:'Notice content', noticeBodyPlaceholder:'Notice content', publishButton:'Publish Notice', noticePublishDenied:'Only owner and admin roles can publish notices.',
      noPermission:'No permission', viewOnly:'View only', save:'Apply exception', restoreOsO:'Restore OSO role', block:'Review block', unblock:'Unblock', protectedAccount:'Protected account', selectSpecialRole:'Select special role', roleReasonPrompt:'Enter the reason for this role exception.', restoreReasonPrompt:'Enter the reason for restoring the OSO automatic role.', blockReasonPrompt:'Enter the reason for blocking this member.', unblockReasonPrompt:'Enter the reason for unblocking this member.', roleSourceOsO:'OSO/M2M source', roleSourceManual:'Admin exception active', roleSourceReturned:'OSO change applied', confirmProtectedBlockPrefix:'This is a protected account. Enter the exact confirmation phrase:\n', adminMembersTitle2:'OSO/Auth0 Member List', adminMembersDesc2:'Common member tiers are directory-only. A site manager may manage only OM/OP accounts in the same site; OM/OP may manage only lower same-site OM/OP accounts. Other-site operational data and files are unavailable. Directors manage lower site managers and all lower accounts, admins manage everyone except owners, and owners manage all accounts.', search:'Search', colMember:'Member', colRole:'Applied / OSO source', colChangeReview:'Special role exception', colManage:'Manage', noMembers:'No members are visible with the current permission, or the API is waiting for connection.', shown:'Shown', serverQuery:'Server query', page:'Page', previous:'Previous', next:'Next',
      reviewDocDefault:'Submitted Document', open:'Open', detail:'Details', approve:'Approve', reject:'Reject', reviewTitle:'Review Queue', reviewRefresh:'Refresh', reviewDesc:'Review member-submitted documents and upgrade/permission requests. Members see only their own records in Member Page. Site-manager, OM, and OP roles review only lower operational records in their own site; directors and site_manager_director review only lower roles. Admins see everyone except owners, and owners see all.', reviewHeadDoc:'Document', reviewHeadMember:'Member', reviewHeadTarget:'Requested Role', reviewHeadStatus:'Status', reviewHeadReview:'Review', noReviewDocs:'No submitted documents are visible with the current permission, or the review API is waiting for connection.', shownItems:'Shown', serverItems:'Server query',
      adminNoticeTitle:'Replies / Notice Management', adminNoticeDesc:'Reply and notice registration buttons are enabled only for administrators.', targetTitleLabel:'Target / Title', targetTitlePlaceholder:'Notice title or reply target', adminNoticeBodyLabel:'Content', adminNoticeBodyPlaceholder:'Notice or reply content', register:'Register',
      registered:'Registered.', reviewTokenMissing:'The site role is visible, but the Auth0 ID token is not connected to the modal/API. Renew the session at the top and reopen the review queue.', reviewApiMissing:'Document review API connection is required.', noAttachment:'No viewable attachment URL is available.', confirmProcess:'Proceed?', memberTokenMissing:'The site role is visible, but the Auth0 ID token is not connected to the modal/API. Renew the session at the top and reopen the member list.', tokenExpiredSuffix:' / The current login session token is missing or expired.', changeNoPerm:'You do not have permission to assign this role.', confirmRoleChangePrefix:'Change this member role to ', confirmRoleChangeSuffix:'?', confirmBlock:'Block or remove this member?', upgradeRequested:'Application submitted.', myReviewTitle:'My Applications and Documents', myReviewDesc:'Only your own submitted applications and documents are shown here.', myReviewNone:'There are no submitted applications or documents.', myReviewOpen:'Open My Submission', myReviewReload:'Refresh My Status', diagnosticTitle:'Supabase Review Store Diagnostic', diagnosticDesc:'This read-only server diagnostic checks review tables, the required site-scope column, the private storage bucket, and the service-role connection. It never includes member data, submitted files, signed URLs, or secrets in the JSON.', diagnosticRun:'Run diagnostic', diagnosticDownload:'Download JSON', diagnosticWaiting:'Running diagnostic.', diagnosticEmpty:'No diagnostic result yet.', diagnosticNotAllowed:'The system diagnostic is limited to owner and admin roles.', diagnosticReadOnly:'The diagnostic is read-only and never creates or modifies production test data.'
    }
  };
  var PROFILE_TEXT = {"ko":{"upgrade":"승급 요청","edit":"회원 정보 수정","title":"회원 정보","upgradeDesc":"필수 회원정보를 입력하면 스탠다드 회원 승급 조건이 OSO/M2M에 전달됩니다.","editDesc":"회원정보를 최신 상태로 유지해 주세요.","fullName":"성명 / 수령인 이름","country":"국가/지역","phone":"연락처","postal":"우편번호","region":"주/도/지역","city":"도시","address1":"주소","address2":"상세 주소","intl":"국제 처리용 영문/로마자 표기 (선택)","romanizedName":"영문/로마자 이름","romanizedAddress1":"영문/로마자 주소","romanizedAddress2":"영문/로마자 상세 주소","optional":"선택","save":"저장","saving":"저장 중…","saved":"회원정보가 저장되었습니다.","eligible":"필수 정보가 완료되었습니다. 스탠다드 회원 승급 조건이 OSO/M2M에 전달되었습니다.","pending":"회원정보는 저장되었으나 자동 회원등급 반영이 아직 대기 중입니다.","loading":"회원정보를 불러오는 중입니다.","required":"필수 항목입니다.","member":"회원","standard":"스탠다드 회원","premium":"프리미엄 회원","missing":"미입력 항목","infoNotice":"주소와 이름은 자국어로 입력할 수 있습니다. 영문/로마자 표기는 국제 배송·결제 등 필요한 경우에만 선택 입력하십시오."},"en":{"upgrade":"Upgrade Request","edit":"Edit Member Information","title":"Member Information","upgradeDesc":"Complete the required profile to send Standard-member eligibility to OSO/M2M.","editDesc":"Keep your member information current.","fullName":"Full name / recipient name","country":"Country / region","phone":"Phone number","postal":"Postal code","region":"State / province / region","city":"City / locality","address1":"Address line 1","address2":"Address line 2","intl":"English / Romanized details for international processing (optional)","romanizedName":"English / Romanized name","romanizedAddress1":"English / Romanized address","romanizedAddress2":"English / Romanized address line 2","optional":"Optional","save":"Save","saving":"Saving…","saved":"Member information has been saved.","eligible":"Required information is complete. Standard-member eligibility was sent to OSO/M2M.","pending":"Member information was saved, but the automatic role reflection is still pending.","loading":"Loading member information.","required":"Required field.","member":"Member","standard":"Standard Member","premium":"Premium Member","missing":"Missing fields","infoNotice":"Names and addresses may be entered in the local language. Add English/Romanized details only when international delivery or payment requires them."},"zh":{"upgrade":"升级申请","edit":"修改会员信息","title":"会员信息","upgradeDesc":"完成必填资料后，标准会员资格将发送至 OSO/M2M。","editDesc":"请保持会员信息为最新状态。","fullName":"姓名 / 收件人姓名","country":"国家/地区","phone":"联系电话","postal":"邮政编码","region":"省/州/地区","city":"城市","address1":"地址","address2":"详细地址","intl":"国际处理用英文/罗马字信息（可选）","romanizedName":"英文/罗马字姓名","romanizedAddress1":"英文/罗马字地址","romanizedAddress2":"英文/罗马字详细地址","optional":"可选","save":"保存","saving":"正在保存…","saved":"会员信息已保存。","eligible":"必填信息已完成。标准会员资格已发送至 OSO/M2M。","pending":"会员信息已保存，但自动角色更新仍在等待中。","loading":"正在加载会员信息。","required":"必填项。","member":"会员","standard":"标准会员","premium":"高级会员","missing":"未填写项目","infoNotice":"姓名和地址可使用当地语言填写。仅在国际配送或付款需要时填写英文/罗马字信息。"},"zht":{"upgrade":"升級申請","edit":"修改會員資料","title":"會員資料","upgradeDesc":"完成必填資料後，標準會員資格將傳送至 OSO/M2M。","editDesc":"請保持會員資料為最新狀態。","fullName":"姓名 / 收件人姓名","country":"國家/地區","phone":"聯絡電話","postal":"郵遞區號","region":"州/省/地區","city":"城市","address1":"地址","address2":"詳細地址","intl":"國際處理用英文/羅馬字資料（選填）","romanizedName":"英文/羅馬字姓名","romanizedAddress1":"英文/羅馬字地址","romanizedAddress2":"英文/羅馬字詳細地址","optional":"選填","save":"儲存","saving":"儲存中…","saved":"會員資料已儲存。","eligible":"必填資料已完成。標準會員資格已傳送至 OSO/M2M。","pending":"會員資料已儲存，但自動角色更新仍在等待中。","loading":"正在載入會員資料。","required":"必填欄位。","member":"會員","standard":"標準會員","premium":"高級會員","missing":"未填欄位","infoNotice":"姓名和地址可使用當地語言填寫。僅在國際配送或付款需要時填寫英文/羅馬字資料。"},"ja":{"upgrade":"昇格申請","edit":"会員情報を編集","title":"会員情報","upgradeDesc":"必須情報を完了すると、スタンダード会員の適格情報が OSO/M2M に送信されます。","editDesc":"会員情報を最新の状態に保ってください。","fullName":"氏名 / 受取人名","country":"国・地域","phone":"電話番号","postal":"郵便番号","region":"都道府県・州・地域","city":"市区町村","address1":"住所","address2":"住所（続き）","intl":"国際処理用の英語・ローマ字表記（任意）","romanizedName":"英語・ローマ字氏名","romanizedAddress1":"英語・ローマ字住所","romanizedAddress2":"英語・ローマ字住所（続き）","optional":"任意","save":"保存","saving":"保存中…","saved":"会員情報を保存しました。","eligible":"必須情報が完了しました。スタンダード会員の適格情報を OSO/M2M に送信しました。","pending":"会員情報は保存されましたが、自動ロール反映は保留中です。","loading":"会員情報を読み込んでいます。","required":"必須項目です。","member":"会員","standard":"スタンダード会員","premium":"プレミアム会員","missing":"未入力項目","infoNotice":"氏名と住所は現地語で入力できます。国際配送・決済で必要な場合のみ英語・ローマ字表記を追加してください。"},"es":{"upgrade":"Solicitar mejora","edit":"Editar información de miembro","title":"Información del miembro","upgradeDesc":"Complete el perfil requerido para enviar la elegibilidad de miembro estándar a OSO/M2M.","editDesc":"Mantenga actualizada su información de miembro.","fullName":"Nombre completo / destinatario","country":"País / región","phone":"Teléfono","postal":"Código postal","region":"Estado / provincia / región","city":"Ciudad / localidad","address1":"Dirección","address2":"Dirección adicional","intl":"Datos en inglés/romanizados para gestión internacional (opcional)","romanizedName":"Nombre en inglés/romanizado","romanizedAddress1":"Dirección en inglés/romanizada","romanizedAddress2":"Dirección adicional en inglés/romanizada","optional":"Opcional","save":"Guardar","saving":"Guardando…","saved":"La información del miembro se ha guardado.","eligible":"La información requerida está completa. La elegibilidad estándar se envió a OSO/M2M.","pending":"La información se guardó, pero la actualización automática del rol sigue pendiente.","loading":"Cargando la información del miembro.","required":"Campo obligatorio.","member":"Miembro","standard":"Miembro estándar","premium":"Miembro prémium","missing":"Campos pendientes","infoNotice":"Los nombres y direcciones pueden escribirse en el idioma local. Añada datos en inglés/romanizados solo si la entrega o el pago internacional lo requiere."},"fr":{"upgrade":"Demander une mise à niveau","edit":"Modifier les informations du membre","title":"Informations du membre","upgradeDesc":"Complétez le profil requis pour transmettre l’éligibilité de membre standard à OSO/M2M.","editDesc":"Gardez vos informations de membre à jour.","fullName":"Nom complet / nom du destinataire","country":"Pays / région","phone":"Téléphone","postal":"Code postal","region":"État / province / région","city":"Ville / localité","address1":"Adresse","address2":"Complément d’adresse","intl":"Informations anglaises/romanisées pour le traitement international (facultatif)","romanizedName":"Nom en anglais/romanisé","romanizedAddress1":"Adresse en anglais/romanisée","romanizedAddress2":"Complément d’adresse en anglais/romanisé","optional":"Facultatif","save":"Enregistrer","saving":"Enregistrement…","saved":"Les informations du membre ont été enregistrées.","eligible":"Les informations requises sont complètes. L’éligibilité standard a été transmise à OSO/M2M.","pending":"Les informations ont été enregistrées, mais la mise à jour automatique du rôle est en attente.","loading":"Chargement des informations du membre.","required":"Champ obligatoire.","member":"Membre","standard":"Membre standard","premium":"Membre premium","missing":"Champs manquants","infoNotice":"Les noms et adresses peuvent être saisis dans la langue locale. Ajoutez une transcription anglaise/romanisée seulement si la livraison ou le paiement international l’exige."},"de":{"upgrade":"Upgrade anfordern","edit":"Mitgliedsdaten bearbeiten","title":"Mitgliedsinformationen","upgradeDesc":"Vervollständigen Sie das erforderliche Profil, um die Standardmitglieds-Berechtigung an OSO/M2M zu senden.","editDesc":"Halten Sie Ihre Mitgliedsinformationen aktuell.","fullName":"Vollständiger Name / Empfängername","country":"Land / Region","phone":"Telefonnummer","postal":"Postleitzahl","region":"Bundesland / Provinz / Region","city":"Stadt / Ort","address1":"Adresse","address2":"Adresszusatz","intl":"Englische/romanische Angaben für internationale Abwicklung (optional)","romanizedName":"Englischer/romanischer Name","romanizedAddress1":"Englische/romanische Adresse","romanizedAddress2":"Englischer/romanischer Adresszusatz","optional":"Optional","save":"Speichern","saving":"Speichern…","saved":"Mitgliedsinformationen wurden gespeichert.","eligible":"Die erforderlichen Angaben sind vollständig. Die Standardmitglieds-Berechtigung wurde an OSO/M2M gesendet.","pending":"Die Mitgliedsinformationen wurden gespeichert, die automatische Rollenübernahme steht noch aus.","loading":"Mitgliedsinformationen werden geladen.","required":"Pflichtfeld.","member":"Mitglied","standard":"Standardmitglied","premium":"Premiummitglied","missing":"Fehlende Felder","infoNotice":"Namen und Adressen können in der Landessprache eingegeben werden. Englische/romanische Angaben sind nur bei internationaler Lieferung oder Zahlung erforderlich."},"ru":{"upgrade":"Запросить повышение","edit":"Изменить данные участника","title":"Данные участника","upgradeDesc":"Заполните обязательный профиль, чтобы передать право на стандартное членство в OSO/M2M.","editDesc":"Поддерживайте данные участника в актуальном состоянии.","fullName":"Полное имя / получатель","country":"Страна / регион","phone":"Телефон","postal":"Почтовый индекс","region":"Регион / область","city":"Город / населённый пункт","address1":"Адрес","address2":"Дополнение к адресу","intl":"Английская/латинская запись для международной обработки (необязательно)","romanizedName":"Имя на английском/латинице","romanizedAddress1":"Адрес на английском/латинице","romanizedAddress2":"Дополнение адреса на английском/латинице","optional":"Необязательно","save":"Сохранить","saving":"Сохранение…","saved":"Данные участника сохранены.","eligible":"Обязательные данные заполнены. Право на стандартное членство отправлено в OSO/M2M.","pending":"Данные сохранены, но автоматическое обновление роли ожидается.","loading":"Загрузка данных участника.","required":"Обязательное поле.","member":"Участник","standard":"Стандартный участник","premium":"Премиум-участник","missing":"Незаполненные поля","infoNotice":"Имя и адрес можно вводить на местном языке. Английскую/латинскую запись добавляйте только при необходимости международной доставки или оплаты."},"pt":{"upgrade":"Solicitar atualização","edit":"Editar informações do membro","title":"Informações do membro","upgradeDesc":"Complete o perfil obrigatório para enviar a elegibilidade de membro padrão ao OSO/M2M.","editDesc":"Mantenha as informações do membro atualizadas.","fullName":"Nome completo / nome do destinatário","country":"País / região","phone":"Telefone","postal":"Código postal","region":"Estado / província / região","city":"Cidade / localidade","address1":"Endereço","address2":"Complemento do endereço","intl":"Dados em inglês/romanizados para processamento internacional (opcional)","romanizedName":"Nome em inglês/romanizado","romanizedAddress1":"Endereço em inglês/romanizado","romanizedAddress2":"Complemento em inglês/romanizado","optional":"Opcional","save":"Salvar","saving":"Salvando…","saved":"As informações do membro foram salvas.","eligible":"As informações obrigatórias estão completas. A elegibilidade padrão foi enviada ao OSO/M2M.","pending":"As informações foram salvas, mas a atualização automática da função está pendente.","loading":"Carregando informações do membro.","required":"Campo obrigatório.","member":"Membro","standard":"Membro padrão","premium":"Membro premium","missing":"Campos pendentes","infoNotice":"Nomes e endereços podem ser inseridos no idioma local. Adicione dados em inglês/romanizados apenas quando a entrega ou pagamento internacional exigir."},"it":{"upgrade":"Richiedi aggiornamento","edit":"Modifica informazioni membro","title":"Informazioni del membro","upgradeDesc":"Completa il profilo richiesto per inviare l’idoneità al membro standard a OSO/M2M.","editDesc":"Mantieni aggiornate le informazioni del membro.","fullName":"Nome completo / destinatario","country":"Paese / regione","phone":"Telefono","postal":"Codice postale","region":"Stato / provincia / regione","city":"Città / località","address1":"Indirizzo","address2":"Dettaglio indirizzo","intl":"Dati in inglese/romanizzati per la gestione internazionale (facoltativo)","romanizedName":"Nome in inglese/romanizzato","romanizedAddress1":"Indirizzo in inglese/romanizzato","romanizedAddress2":"Dettaglio in inglese/romanizzato","optional":"Facoltativo","save":"Salva","saving":"Salvataggio…","saved":"Le informazioni del membro sono state salvate.","eligible":"Le informazioni richieste sono complete. L’idoneità standard è stata inviata a OSO/M2M.","pending":"Le informazioni sono state salvate, ma l’aggiornamento automatico del ruolo è in attesa.","loading":"Caricamento delle informazioni del membro.","required":"Campo obbligatorio.","member":"Membro","standard":"Membro standard","premium":"Membro premium","missing":"Campi mancanti","infoNotice":"Nomi e indirizzi possono essere inseriti nella lingua locale. Aggiungi dati in inglese/romanizzati solo se richiesti da consegna o pagamento internazionale."},"ar":{"upgrade":"طلب الترقية","edit":"تعديل معلومات العضو","title":"معلومات العضو","upgradeDesc":"أكمل الملف المطلوب لإرسال أهلية العضو القياسي إلى OSO/M2M.","editDesc":"حافظ على تحديث معلومات العضو.","fullName":"الاسم الكامل / اسم المستلم","country":"الدولة / المنطقة","phone":"رقم الهاتف","postal":"الرمز البريدي","region":"الولاية / المحافظة / المنطقة","city":"المدينة / المحلية","address1":"العنوان","address2":"تفاصيل العنوان","intl":"بيانات إنجليزية/لاتينية للمعالجة الدولية (اختياري)","romanizedName":"الاسم بالإنجليزية/اللاتينية","romanizedAddress1":"العنوان بالإنجليزية/اللاتينية","romanizedAddress2":"تفاصيل العنوان بالإنجليزية/اللاتينية","optional":"اختياري","save":"حفظ","saving":"جارٍ الحفظ…","saved":"تم حفظ معلومات العضو.","eligible":"اكتملت المعلومات المطلوبة. تم إرسال أهلية العضو القياسي إلى OSO/M2M.","pending":"تم حفظ المعلومات، لكن انعكاس الدور التلقائي ما زال قيد الانتظار.","loading":"جارٍ تحميل معلومات العضو.","required":"حقل مطلوب.","member":"عضو","standard":"عضو قياسي","premium":"عضو مميز","missing":"حقول ناقصة","infoNotice":"يمكن إدخال الأسماء والعناوين باللغة المحلية. أضف البيانات الإنجليزية/اللاتينية فقط عند الحاجة إلى شحن أو دفع دولي."},"vi":{"upgrade":"Yêu cầu nâng hạng","edit":"Chỉnh sửa thông tin thành viên","title":"Thông tin thành viên","upgradeDesc":"Hoàn tất hồ sơ bắt buộc để gửi điều kiện thành viên tiêu chuẩn đến OSO/M2M.","editDesc":"Hãy cập nhật thông tin thành viên của bạn.","fullName":"Họ tên / người nhận","country":"Quốc gia / khu vực","phone":"Số điện thoại","postal":"Mã bưu chính","region":"Tỉnh / bang / khu vực","city":"Thành phố / địa phương","address1":"Địa chỉ","address2":"Địa chỉ bổ sung","intl":"Thông tin tiếng Anh/La-tinh cho xử lý quốc tế (tùy chọn)","romanizedName":"Tên tiếng Anh/La-tinh","romanizedAddress1":"Địa chỉ tiếng Anh/La-tinh","romanizedAddress2":"Địa chỉ bổ sung tiếng Anh/La-tinh","optional":"Tùy chọn","save":"Lưu","saving":"Đang lưu…","saved":"Thông tin thành viên đã được lưu.","eligible":"Thông tin bắt buộc đã hoàn tất. Điều kiện thành viên tiêu chuẩn đã được gửi đến OSO/M2M.","pending":"Thông tin đã được lưu nhưng việc cập nhật vai trò tự động đang chờ.","loading":"Đang tải thông tin thành viên.","required":"Trường bắt buộc.","member":"Thành viên","standard":"Thành viên tiêu chuẩn","premium":"Thành viên cao cấp","missing":"Mục còn thiếu","infoNotice":"Tên và địa chỉ có thể nhập bằng ngôn ngữ địa phương. Chỉ thêm thông tin tiếng Anh/La-tinh khi giao hàng hoặc thanh toán quốc tế yêu cầu."},"th":{"upgrade":"คำขอเลื่อนระดับ","edit":"แก้ไขข้อมูลสมาชิก","title":"ข้อมูลสมาชิก","upgradeDesc":"กรอกข้อมูลที่จำเป็นให้ครบเพื่อส่งสิทธิ์สมาชิกมาตรฐานไปยัง OSO/M2M","editDesc":"โปรดอัปเดตข้อมูลสมาชิกให้เป็นปัจจุบัน","fullName":"ชื่อเต็ม / ชื่อผู้รับ","country":"ประเทศ / ภูมิภาค","phone":"หมายเลขโทรศัพท์","postal":"รหัสไปรษณีย์","region":"รัฐ / จังหวัด / ภูมิภาค","city":"เมือง / ท้องถิ่น","address1":"ที่อยู่","address2":"รายละเอียดที่อยู่","intl":"ข้อมูลภาษาอังกฤษ/อักษรโรมันสำหรับการดำเนินการระหว่างประเทศ (ไม่บังคับ)","romanizedName":"ชื่อภาษาอังกฤษ/อักษรโรมัน","romanizedAddress1":"ที่อยู่ภาษาอังกฤษ/อักษรโรมัน","romanizedAddress2":"รายละเอียดที่อยู่ภาษาอังกฤษ/อักษรโรมัน","optional":"ไม่บังคับ","save":"บันทึก","saving":"กำลังบันทึก…","saved":"บันทึกข้อมูลสมาชิกแล้ว","eligible":"กรอกข้อมูลที่จำเป็นครบแล้ว ส่งสิทธิ์สมาชิกมาตรฐานไปยัง OSO/M2M แล้ว","pending":"บันทึกข้อมูลแล้ว แต่การอัปเดตบทบาทอัตโนมัติยังรอดำเนินการ","loading":"กำลังโหลดข้อมูลสมาชิก","required":"ช่องบังคับ","member":"สมาชิก","standard":"สมาชิกมาตรฐาน","premium":"สมาชิกพรีเมียม","missing":"ช่องที่ขาด","infoNotice":"ชื่อและที่อยู่สามารถกรอกเป็นภาษาท้องถิ่นได้ เพิ่มข้อมูลภาษาอังกฤษ/อักษรโรมันเฉพาะเมื่อจำเป็นสำหรับการจัดส่งหรือชำระเงินระหว่างประเทศ"},"id":{"upgrade":"Ajukan peningkatan","edit":"Edit informasi anggota","title":"Informasi anggota","upgradeDesc":"Lengkapi profil wajib untuk mengirim kelayakan anggota standar ke OSO/M2M.","editDesc":"Pastikan informasi anggota tetap terbaru.","fullName":"Nama lengkap / penerima","country":"Negara / wilayah","phone":"Nomor telepon","postal":"Kode pos","region":"Negara bagian / provinsi / wilayah","city":"Kota / lokalitas","address1":"Alamat","address2":"Detail alamat","intl":"Data Inggris/Romanisasi untuk pemrosesan internasional (opsional)","romanizedName":"Nama Inggris/Romanisasi","romanizedAddress1":"Alamat Inggris/Romanisasi","romanizedAddress2":"Detail alamat Inggris/Romanisasi","optional":"Opsional","save":"Simpan","saving":"Menyimpan…","saved":"Informasi anggota telah disimpan.","eligible":"Informasi wajib telah lengkap. Kelayakan anggota standar dikirim ke OSO/M2M.","pending":"Informasi telah disimpan, tetapi pembaruan peran otomatis masih menunggu.","loading":"Memuat informasi anggota.","required":"Kolom wajib.","member":"Anggota","standard":"Anggota standar","premium":"Anggota premium","missing":"Kolom belum lengkap","infoNotice":"Nama dan alamat dapat dimasukkan dalam bahasa setempat. Tambahkan data Inggris/Romanisasi hanya jika pengiriman atau pembayaran internasional memerlukannya."},"hi":{"upgrade":"अपग्रेड अनुरोध","edit":"सदस्य जानकारी संपादित करें","title":"सदस्य जानकारी","upgradeDesc":"OSO/M2M को मानक सदस्य पात्रता भेजने के लिए आवश्यक प्रोफ़ाइल पूरी करें।","editDesc":"अपनी सदस्य जानकारी अद्यतन रखें।","fullName":"पूरा नाम / प्राप्तकर्ता का नाम","country":"देश / क्षेत्र","phone":"फोन नंबर","postal":"डाक कोड","region":"राज्य / प्रांत / क्षेत्र","city":"शहर / स्थानीय क्षेत्र","address1":"पता","address2":"पते का अतिरिक्त विवरण","intl":"अंतरराष्ट्रीय प्रक्रिया के लिए अंग्रेज़ी/रोमन विवरण (वैकल्पिक)","romanizedName":"अंग्रेज़ी/रोमन नाम","romanizedAddress1":"अंग्रेज़ी/रोमन पता","romanizedAddress2":"अंग्रेज़ी/रोमन पते का विवरण","optional":"वैकल्पिक","save":"सहेजें","saving":"सहेजा जा रहा है…","saved":"सदस्य जानकारी सहेज दी गई है।","eligible":"आवश्यक जानकारी पूरी है। मानक सदस्य पात्रता OSO/M2M को भेज दी गई है।","pending":"सदस्य जानकारी सहेज दी गई है, पर स्वचालित भूमिका अपडेट लंबित है।","loading":"सदस्य जानकारी लोड हो रही है।","required":"अनिवार्य फ़ील्ड।","member":"सदस्य","standard":"मानक सदस्य","premium":"प्रीमियम सदस्य","missing":"अपूर्ण फ़ील्ड","infoNotice":"नाम और पते स्थानीय भाषा में दर्ज किए जा सकते हैं। अंग्रेज़ी/रोमन विवरण केवल अंतरराष्ट्रीय डिलीवरी या भुगतान की आवश्यकता पर जोड़ें।"},"tr":{"upgrade":"Yükseltme talebi","edit":"Üye bilgilerini düzenle","title":"Üye bilgileri","upgradeDesc":"Standart üyelik uygunluğunu OSO/M2M’ye göndermek için gerekli profili tamamlayın.","editDesc":"Üye bilgilerinizi güncel tutun.","fullName":"Ad soyad / alıcı adı","country":"Ülke / bölge","phone":"Telefon numarası","postal":"Posta kodu","region":"Eyalet / il / bölge","city":"Şehir / yerleşim","address1":"Adres","address2":"Adres ayrıntısı","intl":"Uluslararası işlem için İngilizce/Romanize bilgiler (isteğe bağlı)","romanizedName":"İngilizce/Romanize ad","romanizedAddress1":"İngilizce/Romanize adres","romanizedAddress2":"İngilizce/Romanize adres ayrıntısı","optional":"İsteğe bağlı","save":"Kaydet","saving":"Kaydediliyor…","saved":"Üye bilgileri kaydedildi.","eligible":"Zorunlu bilgiler tamamlandı. Standart üyelik uygunluğu OSO/M2M’ye gönderildi.","pending":"Üye bilgileri kaydedildi ancak otomatik rol yansıtması beklemede.","loading":"Üye bilgileri yükleniyor.","required":"Zorunlu alan.","member":"Üye","standard":"Standart üye","premium":"Premium üye","missing":"Eksik alanlar","infoNotice":"Adlar ve adresler yerel dilde girilebilir. İngilizce/Romanize bilgileri yalnızca uluslararası teslimat veya ödeme gerektiğinde ekleyin."},"fa":{"upgrade":"درخواست ارتقا","edit":"ویرایش اطلاعات عضو","title":"اطلاعات عضو","upgradeDesc":"برای ارسال واجد شرایط بودن عضویت استاندارد به OSO/M2M، مشخصات لازم را تکمیل کنید.","editDesc":"اطلاعات عضو را به‌روز نگه دارید.","fullName":"نام کامل / نام گیرنده","country":"کشور / منطقه","phone":"شماره تلفن","postal":"کد پستی","region":"استان / منطقه","city":"شهر / محل","address1":"نشانی","address2":"جزئیات نشانی","intl":"اطلاعات انگلیسی/رومی برای پردازش بین‌المللی (اختیاری)","romanizedName":"نام انگلیسی/رومی","romanizedAddress1":"نشانی انگلیسی/رومی","romanizedAddress2":"جزئیات نشانی انگلیسی/رومی","optional":"اختیاری","save":"ذخیره","saving":"در حال ذخیره…","saved":"اطلاعات عضو ذخیره شد.","eligible":"اطلاعات لازم کامل است. واجد شرایط بودن عضویت استاندارد به OSO/M2M ارسال شد.","pending":"اطلاعات عضو ذخیره شد، اما بازتاب خودکار نقش در انتظار است.","loading":"در حال بارگیری اطلاعات عضو.","required":"فیلد الزامی.","member":"عضو","standard":"عضو استاندارد","premium":"عضو ویژه","missing":"فیلدهای ناقص","infoNotice":"نام و نشانی را می‌توان به زبان محلی وارد کرد. فقط در صورت نیاز به تحویل یا پرداخت بین‌المللی اطلاعات انگلیسی/رومی را اضافه کنید."},"bn":{"upgrade":"আপগ্রেড অনুরোধ","edit":"সদস্য তথ্য সম্পাদনা","title":"সদস্য তথ্য","upgradeDesc":"স্ট্যান্ডার্ড সদস্যের যোগ্যতা OSO/M2M-এ পাঠাতে প্রয়োজনীয় প্রোফাইল পূরণ করুন।","editDesc":"সদস্য তথ্য হালনাগাদ রাখুন।","fullName":"পূর্ণ নাম / প্রাপকের নাম","country":"দেশ / অঞ্চল","phone":"ফোন নম্বর","postal":"পোস্টাল কোড","region":"রাজ্য / প্রদেশ / অঞ্চল","city":"শহর / স্থানীয় এলাকা","address1":"ঠিকানা","address2":"ঠিকানার বিবরণ","intl":"আন্তর্জাতিক প্রক্রিয়ার জন্য ইংরেজি/রোমানাইজড তথ্য (ঐচ্ছিক)","romanizedName":"ইংরেজি/রোমানাইজড নাম","romanizedAddress1":"ইংরেজি/রোমানাইজড ঠিকানা","romanizedAddress2":"ইংরেজি/রোমানাইজড ঠিকানার বিবরণ","optional":"ঐচ্ছিক","save":"সংরক্ষণ","saving":"সংরক্ষণ করা হচ্ছে…","saved":"সদস্য তথ্য সংরক্ষিত হয়েছে।","eligible":"প্রয়োজনীয় তথ্য সম্পূর্ণ। স্ট্যান্ডার্ড সদস্যের যোগ্যতা OSO/M2M-এ পাঠানো হয়েছে।","pending":"সদস্য তথ্য সংরক্ষিত হয়েছে, তবে স্বয়ংক্রিয় ভূমিকা প্রতিফলন অপেক্ষমাণ।","loading":"সদস্য তথ্য লোড হচ্ছে।","required":"আবশ্যক ক্ষেত্র।","member":"সদস্য","standard":"স্ট্যান্ডার্ড সদস্য","premium":"প্রিমিয়াম সদস্য","missing":"অসম্পূর্ণ ক্ষেত্র","infoNotice":"নাম ও ঠিকানা স্থানীয় ভাষায় লেখা যায়। আন্তর্জাতিক ডেলিভারি বা পেমেন্টে প্রয়োজন হলে শুধু ইংরেজি/রোমানাইজড তথ্য যোগ করুন।"},"ur":{"upgrade":"اپ گریڈ کی درخواست","edit":"رکن کی معلومات میں ترمیم","title":"رکن کی معلومات","upgradeDesc":"اسٹینڈرڈ رکن کی اہلیت OSO/M2M کو بھیجنے کے لیے مطلوبہ پروفائل مکمل کریں۔","editDesc":"اپنی رکن معلومات کو تازہ رکھیں۔","fullName":"پورا نام / وصول کنندہ کا نام","country":"ملک / علاقہ","phone":"فون نمبر","postal":"پوسٹل کوڈ","region":"صوبہ / خطہ","city":"شہر / مقام","address1":"پتہ","address2":"پتے کی تفصیل","intl":"بین الاقوامی کارروائی کے لیے انگریزی/رومن معلومات (اختیاری)","romanizedName":"انگریزی/رومن نام","romanizedAddress1":"انگریزی/رومن پتہ","romanizedAddress2":"انگریزی/رومن پتے کی تفصیل","optional":"اختیاری","save":"محفوظ کریں","saving":"محفوظ کیا جا رہا ہے…","saved":"رکن کی معلومات محفوظ ہو گئی ہیں۔","eligible":"مطلوبہ معلومات مکمل ہیں۔ اسٹینڈرڈ رکن کی اہلیت OSO/M2M کو بھیج دی گئی ہے۔","pending":"رکن کی معلومات محفوظ ہو گئی ہیں، مگر خودکار کردار کی عکاسی زیر التوا ہے۔","loading":"رکن کی معلومات لوڈ ہو رہی ہیں۔","required":"لازمی خانہ۔","member":"رکن","standard":"اسٹینڈرڈ رکن","premium":"پریمیم رکن","missing":"نامکمل خانے","infoNotice":"نام اور پتے مقامی زبان میں درج کیے جا سکتے ہیں۔ انگریزی/رومن معلومات صرف بین الاقوامی ترسیل یا ادائیگی کی ضرورت پر شامل کریں۔"},"sw":{"upgrade":"Ombi la kuboresha","edit":"Hariri taarifa za mwanachama","title":"Taarifa za mwanachama","upgradeDesc":"Kamilisha wasifu unaohitajika ili kutuma ustahiki wa mwanachama wa kawaida kwa OSO/M2M.","editDesc":"Weka taarifa za mwanachama zikiwa za sasa.","fullName":"Jina kamili / jina la mpokeaji","country":"Nchi / eneo","phone":"Nambari ya simu","postal":"Msimbo wa posta","region":"Jimbo / mkoa / eneo","city":"Jiji / eneo la makazi","address1":"Anwani","address2":"Maelezo ya anwani","intl":"Maelezo ya Kiingereza/Romanized kwa uchakataji wa kimataifa (hiari)","romanizedName":"Jina la Kiingereza/Romanized","romanizedAddress1":"Anwani ya Kiingereza/Romanized","romanizedAddress2":"Maelezo ya anwani ya Kiingereza/Romanized","optional":"Hiari","save":"Hifadhi","saving":"Inahifadhi…","saved":"Taarifa za mwanachama zimehifadhiwa.","eligible":"Taarifa zinazohitajika zimekamilika. Ustahiki wa mwanachama wa kawaida umetumwa kwa OSO/M2M.","pending":"Taarifa zimehifadhiwa, lakini sasisho la jukumu kiotomatiki linasubiri.","loading":"Inapakia taarifa za mwanachama.","required":"Sehemu inayohitajika.","member":"Mwanachama","standard":"Mwanachama wa kawaida","premium":"Mwanachama wa malipo","missing":"Sehemu zinazokosekana","infoNotice":"Majina na anwani zinaweza kuingizwa kwa lugha ya eneo. Ongeza maelezo ya Kiingereza/Romanized tu inapohitajika kwa usafirishaji au malipo ya kimataifa."},"ta":{"upgrade":"மேம்படுத்தல் கோரிக்கை","edit":"உறுப்பினர் தகவலைத் திருத்து","title":"உறுப்பினர் தகவல்","upgradeDesc":"ஸ்டாண்டர்டு உறுப்பினர் தகுதியை OSO/M2M-க்கு அனுப்ப தேவையான சுயவிவரத்தை நிறைவு செய்யவும்.","editDesc":"உங்கள் உறுப்பினர் தகவலை புதுப்பித்த நிலையில் வைத்திருங்கள்.","fullName":"முழுப் பெயர் / பெறுநர் பெயர்","country":"நாடு / பகுதி","phone":"தொலைபேசி எண்","postal":"அஞ்சல் குறியீடு","region":"மாநிலம் / மாகாணம் / பகுதி","city":"நகரம் / வட்டாரம்","address1":"முகவரி","address2":"முகவரி விவரம்","intl":"சர்வதேச செயலாக்கத்திற்கான ஆங்கில/ரோமன் தகவல் (விருப்பம்)","romanizedName":"ஆங்கில/ரோமன் பெயர்","romanizedAddress1":"ஆங்கில/ரோமன் முகவரி","romanizedAddress2":"ஆங்கில/ரோமன் முகவரி விவரம்","optional":"விருப்பம்","save":"சேமி","saving":"சேமிக்கப்படுகிறது…","saved":"உறுப்பினர் தகவல் சேமிக்கப்பட்டது.","eligible":"தேவையான தகவல் நிறைவடைந்தது. ஸ்டாண்டர்டு உறுப்பினர் தகுதி OSO/M2M-க்கு அனுப்பப்பட்டது.","pending":"உறுப்பினர் தகவல் சேமிக்கப்பட்டது, ஆனால் தானியங்கி பங்கு புதுப்பிப்பு நிலுவையில் உள்ளது.","loading":"உறுப்பினர் தகவல் ஏற்றப்படுகிறது.","required":"தேவையான புலம்.","member":"உறுப்பினர்","standard":"ஸ்டாண்டர்டு உறுப்பினர்","premium":"பிரீமியம் உறுப்பினர்","missing":"விடுபட்ட புலங்கள்","infoNotice":"பெயர் மற்றும் முகவரியை உள்ளூர் மொழியில் உள்ளிடலாம். சர்வதேச விநியோகம் அல்லது கட்டணம் தேவைப்பட்டால் மட்டும் ஆங்கில/ரோமன் தகவலைச் சேர்க்கவும்."},"hu":{"upgrade":"Szintemelési kérelem","edit":"Tagsági adatok szerkesztése","title":"Tagsági adatok","upgradeDesc":"Töltse ki a szükséges profilt, hogy a standard tagsági jogosultságot elküldje az OSO/M2M rendszernek.","editDesc":"Tartsa naprakészen tagsági adatait.","fullName":"Teljes név / címzett neve","country":"Ország / régió","phone":"Telefonszám","postal":"Irányítószám","region":"Állam / megye / régió","city":"Város / település","address1":"Cím","address2":"Cím kiegészítése","intl":"Angol/latin betűs adatok nemzetközi feldolgozáshoz (opcionális)","romanizedName":"Angol/latin betűs név","romanizedAddress1":"Angol/latin betűs cím","romanizedAddress2":"Angol/latin betűs címkiegészítés","optional":"Opcionális","save":"Mentés","saving":"Mentés…","saved":"A tagsági adatok mentve lettek.","eligible":"A szükséges adatok teljesek. A standard tagsági jogosultság elküldve az OSO/M2M rendszernek.","pending":"A tagsági adatok mentve lettek, de az automatikus szerepfrissítés függőben van.","loading":"Tagsági adatok betöltése.","required":"Kötelező mező.","member":"Tag","standard":"Standard tag","premium":"Prémium tag","missing":"Hiányzó mezők","infoNotice":"A név és cím helyi nyelven is megadható. Angol/latin betűs adatokat csak nemzetközi szállítás vagy fizetés esetén adjon meg."},"ms":{"upgrade":"Permohonan naik taraf","edit":"Sunting maklumat ahli","title":"Maklumat ahli","upgradeDesc":"Lengkapkan profil yang diperlukan untuk menghantar kelayakan ahli standard ke OSO/M2M.","editDesc":"Pastikan maklumat ahli sentiasa terkini.","fullName":"Nama penuh / nama penerima","country":"Negara / wilayah","phone":"Nombor telefon","postal":"Poskod","region":"Negeri / wilayah / kawasan","city":"Bandar / lokaliti","address1":"Alamat","address2":"Butiran alamat","intl":"Butiran Inggeris/Romanisasi untuk pemprosesan antarabangsa (pilihan)","romanizedName":"Nama Inggeris/Romanisasi","romanizedAddress1":"Alamat Inggeris/Romanisasi","romanizedAddress2":"Butiran alamat Inggeris/Romanisasi","optional":"Pilihan","save":"Simpan","saving":"Menyimpan…","saved":"Maklumat ahli telah disimpan.","eligible":"Maklumat diperlukan telah lengkap. Kelayakan ahli standard telah dihantar ke OSO/M2M.","pending":"Maklumat ahli telah disimpan, tetapi kemas kini peranan automatik masih menunggu.","loading":"Memuatkan maklumat ahli.","required":"Medan wajib.","member":"Ahli","standard":"Ahli standard","premium":"Ahli premium","missing":"Medan belum lengkap","infoNotice":"Nama dan alamat boleh dimasukkan dalam bahasa tempatan. Tambah butiran Inggeris/Romanisasi hanya jika penghantaran atau pembayaran antarabangsa memerlukannya."},"nl":{"upgrade":"Upgrade aanvragen","edit":"Lidgegevens bewerken","title":"Lidgegevens","upgradeDesc":"Vul het vereiste profiel in om de geschiktheid voor standaardlidmaatschap naar OSO/M2M te sturen.","editDesc":"Houd uw lidgegevens actueel.","fullName":"Volledige naam / naam ontvanger","country":"Land / regio","phone":"Telefoonnummer","postal":"Postcode","region":"Staat / provincie / regio","city":"Stad / plaats","address1":"Adres","address2":"Adresaanvulling","intl":"Engelse/geromaniseerde gegevens voor internationale verwerking (optioneel)","romanizedName":"Engelse/geromaniseerde naam","romanizedAddress1":"Engels/geromaniseerd adres","romanizedAddress2":"Engelse/geromaniseerde adresaanvulling","optional":"Optioneel","save":"Opslaan","saving":"Opslaan…","saved":"Lidgegevens zijn opgeslagen.","eligible":"De vereiste gegevens zijn compleet. De geschiktheid voor standaardlidmaatschap is naar OSO/M2M gestuurd.","pending":"Lidgegevens zijn opgeslagen, maar de automatische rolupdate wacht nog.","loading":"Lidgegevens laden.","required":"Verplicht veld.","member":"Lid","standard":"Standaardlid","premium":"Premiumlid","missing":"Ontbrekende velden","infoNotice":"Namen en adressen mogen in de lokale taal worden ingevoerd. Voeg alleen Engelse/geromaniseerde gegevens toe wanneer internationale levering of betaling dit vereist."},"pl":{"upgrade":"Wniosek o podwyższenie poziomu","edit":"Edytuj dane członka","title":"Dane członka","upgradeDesc":"Uzupełnij wymagany profil, aby przesłać uprawnienie członka standardowego do OSO/M2M.","editDesc":"Dbaj o aktualność danych członka.","fullName":"Imię i nazwisko / odbiorca","country":"Kraj / region","phone":"Numer telefonu","postal":"Kod pocztowy","region":"Województwo / prowincja / region","city":"Miasto / miejscowość","address1":"Adres","address2":"Uzupełnienie adresu","intl":"Dane angielskie/romanizowane do obsługi międzynarodowej (opcjonalne)","romanizedName":"Imię i nazwisko po angielsku/romanizowane","romanizedAddress1":"Adres po angielsku/romanizowany","romanizedAddress2":"Uzupełnienie adresu po angielsku/romanizowane","optional":"Opcjonalne","save":"Zapisz","saving":"Zapisywanie…","saved":"Dane członka zostały zapisane.","eligible":"Wymagane informacje są kompletne. Uprawnienie członka standardowego wysłano do OSO/M2M.","pending":"Dane członka zapisano, ale automatyczna aktualizacja roli oczekuje.","loading":"Ładowanie danych członka.","required":"Pole wymagane.","member":"Członek","standard":"Członek standardowy","premium":"Członek premium","missing":"Brakujące pola","infoNotice":"Nazwiska i adresy można wpisywać w języku lokalnym. Dane angielskie/romanizowane dodawaj tylko, gdy wymaga tego dostawa lub płatność międzynarodowa."},"sv":{"upgrade":"Begär uppgradering","edit":"Redigera medlemsuppgifter","title":"Medlemsuppgifter","upgradeDesc":"Fyll i den nödvändiga profilen för att skicka standardmedlemsbehörighet till OSO/M2M.","editDesc":"Håll medlemsuppgifterna uppdaterade.","fullName":"Fullständigt namn / mottagare","country":"Land / region","phone":"Telefonnummer","postal":"Postnummer","region":"Delstat / provins / region","city":"Stad / ort","address1":"Adress","address2":"Adressrad 2","intl":"Engelska/romaniserade uppgifter för internationell hantering (valfritt)","romanizedName":"Engelskt/romaniserat namn","romanizedAddress1":"Engelsk/romaniserad adress","romanizedAddress2":"Engelsk/romaniserad adressrad 2","optional":"Valfritt","save":"Spara","saving":"Sparar…","saved":"Medlemsuppgifterna har sparats.","eligible":"Obligatoriska uppgifter är kompletta. Standardmedlemsbehörighet har skickats till OSO/M2M.","pending":"Medlemsuppgifterna har sparats, men automatisk rolluppdatering väntar.","loading":"Laddar medlemsuppgifter.","required":"Obligatoriskt fält.","member":"Medlem","standard":"Standardmedlem","premium":"Premiummedlem","missing":"Saknade fält","infoNotice":"Namn och adresser kan anges på lokalt språk. Lägg till engelska/romaniserade uppgifter endast när internationell leverans eller betalning kräver det."},"tl":{"upgrade":"Humiling ng pag-upgrade","edit":"I-edit ang impormasyon ng miyembro","title":"Impormasyon ng miyembro","upgradeDesc":"Kumpletuhin ang kinakailangang profile upang ipadala ang pagiging karapat-dapat sa Standard Member sa OSO/M2M.","editDesc":"Panatilihing napapanahon ang impormasyon ng miyembro.","fullName":"Buong pangalan / pangalan ng tatanggap","country":"Bansa / rehiyon","phone":"Numero ng telepono","postal":"Postal code","region":"Estado / lalawigan / rehiyon","city":"Lungsod / lokalidad","address1":"Address","address2":"Karagdagang address","intl":"Detalye sa English/Romanized para sa internasyonal na pagproseso (opsyonal)","romanizedName":"Pangalan sa English/Romanized","romanizedAddress1":"Address sa English/Romanized","romanizedAddress2":"Karagdagang address sa English/Romanized","optional":"Opsyonal","save":"I-save","saving":"Sine-save…","saved":"Na-save ang impormasyon ng miyembro.","eligible":"Kumpleto ang kinakailangang impormasyon. Ipinadala ang pagiging karapat-dapat sa Standard Member sa OSO/M2M.","pending":"Na-save ang impormasyon ng miyembro ngunit nakabinbin pa ang awtomatikong pag-update ng papel.","loading":"Naglo-load ng impormasyon ng miyembro.","required":"Kinakailangang field.","member":"Miyembro","standard":"Standard na miyembro","premium":"Premium na miyembro","missing":"Kulang na field","infoNotice":"Maaaring ilagay ang pangalan at address sa lokal na wika. Magdagdag lamang ng English/Romanized na detalye kapag kailangan para sa internasyonal na paghahatid o pagbabayad."},"uk":{"upgrade":"Запит на підвищення","edit":"Редагувати дані учасника","title":"Дані учасника","upgradeDesc":"Заповніть обов’язковий профіль, щоб передати право на стандартне членство до OSO/M2M.","editDesc":"Підтримуйте дані учасника актуальними.","fullName":"Повне ім’я / одержувач","country":"Країна / регіон","phone":"Номер телефону","postal":"Поштовий індекс","region":"Область / регіон","city":"Місто / населений пункт","address1":"Адреса","address2":"Деталі адреси","intl":"Англійська/латинська транслітерація для міжнародної обробки (необов’язково)","romanizedName":"Ім’я англійською/латинкою","romanizedAddress1":"Адреса англійською/латинкою","romanizedAddress2":"Деталі адреси англійською/латинкою","optional":"Необов’язково","save":"Зберегти","saving":"Збереження…","saved":"Дані учасника збережено.","eligible":"Обов’язкові дані заповнено. Право на стандартне членство надіслано до OSO/M2M.","pending":"Дані учасника збережено, але автоматичне оновлення ролі очікується.","loading":"Завантаження даних учасника.","required":"Обов’язкове поле.","member":"Учасник","standard":"Стандартний учасник","premium":"Преміум-учасник","missing":"Незаповнені поля","infoNotice":"Ім’я та адресу можна вводити місцевою мовою. Додавайте англійську/латинську транслітерацію лише за потреби міжнародної доставки або оплати."},"uz":{"upgrade":"Darajani oshirish so‘rovi","edit":"A’zo ma’lumotlarini tahrirlash","title":"A’zo ma’lumotlari","upgradeDesc":"Standart a’zolik mosligini OSO/M2M ga yuborish uchun zarur profilni to‘ldiring.","editDesc":"A’zo ma’lumotlaringizni yangilab turing.","fullName":"To‘liq ism / qabul qiluvchi ismi","country":"Mamlakat / hudud","phone":"Telefon raqami","postal":"Pochta indeksi","region":"Viloyat / hudud","city":"Shahar / aholi punkti","address1":"Manzil","address2":"Manzil tafsiloti","intl":"Xalqaro ishlov uchun inglizcha/romanlashtirilgan ma’lumotlar (ixtiyoriy)","romanizedName":"Inglizcha/romanlashtirilgan ism","romanizedAddress1":"Inglizcha/romanlashtirilgan manzil","romanizedAddress2":"Inglizcha/romanlashtirilgan manzil tafsiloti","optional":"Ixtiyoriy","save":"Saqlash","saving":"Saqlanmoqda…","saved":"A’zo ma’lumotlari saqlandi.","eligible":"Zarur ma’lumotlar to‘liq. Standart a’zolik mosligi OSO/M2M ga yuborildi.","pending":"A’zo ma’lumotlari saqlandi, ammo avtomatik rol yangilanishi kutilmoqda.","loading":"A’zo ma’lumotlari yuklanmoqda.","required":"Majburiy maydon.","member":"A’zo","standard":"Standart a’zo","premium":"Premium a’zo","missing":"To‘ldirilmagan maydonlar","infoNotice":"Ism va manzilni mahalliy tilda kiritish mumkin. Inglizcha/romanlashtirilgan ma’lumotlarni faqat xalqaro yetkazib berish yoki to‘lov talab qilganda qo‘shing."}};
  function profileText() { return PROFILE_TEXT[lang()] || PROFILE_TEXT.en; }
  function uiText() { return UI_TEXT[lang()] || UI_TEXT.en; }
  var PROFILE_COUNTRY_CODES = ["AW","AF","AO","AI","AX","AL","AD","AE","AR","AM","AS","AQ","TF","AG","AU","AT","AZ","BI","BE","BJ","BQ","BF","BD","BG","BH","BS","BA","BL","BY","BZ","BM","BO","BR","BB","BN","BT","BV","BW","CF","CA","CC","CH","CL","CN","CI","CM","CD","CG","CK","CO","KM","CV","CR","CU","CW","CX","KY","CY","CZ","DE","DJ","DM","DK","DO","DZ","EC","EG","ER","EH","ES","EE","ET","FI","FJ","FK","FR","FO","FM","GA","GB","GE","GG","GH","GI","GN","GP","GM","GW","GQ","GR","GD","GL","GT","GF","GU","GY","HK","HM","HN","HR","HT","HU","ID","IM","IN","IO","IE","IR","IQ","IS","IL","IT","JM","JE","JO","JP","KZ","KE","KG","KH","KI","KN","KR","KW","LA","LB","LR","LY","LC","LI","LK","LS","LT","LU","LV","MO","MF","MA","MC","MD","MG","MV","MX","MH","MK","ML","MT","MM","ME","MN","MP","MZ","MR","MS","MQ","MU","MW","MY","YT","NA","NC","NE","NF","NG","NI","NU","NL","NO","NP","NR","NZ","OM","PK","PA","PN","PE","PH","PW","PG","PL","PR","KP","PT","PY","PS","PF","QA","RE","RO","RU","RW","SA","SD","SN","SG","GS","SH","SJ","SB","SL","SV","SM","SO","PM","RS","SS","ST","SR","SK","SI","SE","SZ","SX","SC","SY","TC","TD","TG","TH","TJ","TK","TM","TL","TO","TT","TN","TR","TV","TW","TZ","UG","UA","UM","UY","US","UZ","VA","VC","VE","VG","VI","VN","VU","WF","WS","YE","ZA","ZM","ZW"];
  function localizedCountryName(code) {
    try {
      if (window.Intl && typeof window.Intl.DisplayNames === 'function') {
        var locale = lang() === 'zht' ? 'zh-Hant' : lang();
        return new window.Intl.DisplayNames([locale], {type:'region'}).of(code) || code;
      }
    } catch (e) {}
    return code;
  }
  function countryOptionsHtml(value) {
    var selected = String(value || '').toUpperCase();
    var p = profileText();
    var first = '<option value="">— '+esc(p.country)+' —</option>';
    return first + PROFILE_COUNTRY_CODES.map(function(code) {
      return '<option value="'+esc(code)+'" '+(code === selected ? 'selected' : '')+'>'+esc(localizedCountryName(code))+' ('+esc(code)+')</option>';
    }).join('');
  }
  function membershipRole(me) {
    var state = me && me.role_state || {};
    var source = normalizeRole(state.source_role || '');
    if (source === 'member' || source === 'member_standard' || source === 'member_premium') return source;
    var effective = normalizeRole(me && me.role || '');
    if (effective === 'member' || effective === 'member_standard' || effective === 'member_premium') return effective;
    return effective || 'guest';
  }
  // Membership tier identifiers are intentionally fixed in global English.
  // The surrounding buttons, field labels, help, and validation guidance remain
  // localized in the 30-language profile UI.
  function membershipRoleLabel(role) {
    role = normalizeRole(role);
    if (role === 'member') return 'Member';
    if (role === 'member_standard') return 'Member Standard';
    if (role === 'member_premium') return 'Member Premium';
    return role || 'guest';
  }
  function displayRoleLabel(me) {
    var tier = membershipRole(me);
    if (tier === 'member' || tier === 'member_standard' || tier === 'member_premium') return membershipRoleLabel(tier);
    return normalizeRole(me && me.role) || 'guest';
  }
  function profileMissingLabel(field) {
    var p = profileText();
    var map = {
      full_name:p.fullName, country_code:p.country, phone_e164:p.phone,
      locality:p.city, address_line1:p.address1
    };
    return map[field] || field;
  }
  function profileValue(profile, key) {
    return profile && profile[key] != null ? String(profile[key]) : '';
  }
  function profileInput(name, label, value, required, attrs) {
    return '<label>'+esc(label)+(required ? ' <span class="muted">('+esc(profileText().required)+')</span>' : '')+
      '<input name="'+esc(name)+'" value="'+esc(value)+'" '+(required ? 'required ' : '')+(attrs || '')+'></label>';
  }
  function memberProfileHtml(me) {
    var p = profileText();
    var profile = STATE.memberProfile || {};
    if (STATE.loadingMemberProfile) return '<section class="card"><h4>'+esc(p.title)+'</h4><div class="muted">'+esc(p.loading)+'</div></section>';
    var tier = membershipRole(me);
    var upgrading = tier === 'member';
    var message = STATE.profileMessage ? '<div class="ok">'+esc(STATE.profileMessage)+'</div>' : '';
    var missing = Array.isArray(profile.missing_fields) && profile.missing_fields.length
      ? '<div class="muted" style="margin-top:10px"><b>'+esc(p.missing)+':</b> '+esc(profile.missing_fields.map(profileMissingLabel).join(', '))+'</div>'
      : '';
    var dir = isRtlLanguage(lang()) ? ' dir="rtl"' : '';
    return '<form class="card igdc-ma-profile-form" data-form="member-profile"'+dir+'>'+
      '<h4>'+esc(p.title)+'</h4><div class="muted">'+esc(upgrading ? p.upgradeDesc : p.editDesc)+'</div><div class="muted" style="margin-top:8px">'+esc(p.infoNotice)+'</div><br>'+
      message+
      '<div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">'+
        profileInput('full_name',p.fullName,profileValue(profile,'full_name'),true,'autocomplete="name" maxlength="240"')+
        '<label>'+esc(p.country)+' <span class="muted">('+esc(p.required)+')</span><select name="country_code" required autocomplete="country">'+countryOptionsHtml(profileValue(profile,'country_code'))+'</select></label>'+
        profileInput('phone_e164',p.phone,profileValue(profile,'phone_e164'),true,'autocomplete="tel" inputmode="tel" placeholder="+821012345678" pattern="\+[1-9][0-9]{6,18}" maxlength="20"')+
        profileInput('postal_code',p.postal,profileValue(profile,'postal_code'),false,'autocomplete="postal-code" maxlength="80"')+
        profileInput('administrative_area',p.region,profileValue(profile,'administrative_area'),false,'autocomplete="address-level1" maxlength="180"')+
        profileInput('locality',p.city,profileValue(profile,'locality'),true,'autocomplete="address-level2" maxlength="180"')+
      '</div><br>'+
      profileInput('address_line1',p.address1,profileValue(profile,'address_line1'),true,'autocomplete="address-line1" maxlength="500"')+'<br><br>'+
      profileInput('address_line2',p.address2+' ('+p.optional+')',profileValue(profile,'address_line2'),false,'autocomplete="address-line2" maxlength="500"')+'<br><br>'+
      '<details><summary>'+esc(p.intl)+'</summary><div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:12px">'+
        profileInput('romanized_name',p.romanizedName,profileValue(profile,'romanized_name'),false,'maxlength="240"')+
        profileInput('romanized_address_line1',p.romanizedAddress1,profileValue(profile,'romanized_address_line1'),false,'maxlength="500"')+
      '</div><br>'+profileInput('romanized_address_line2',p.romanizedAddress2,profileValue(profile,'romanized_address_line2'),false,'maxlength="500"')+'</details><br>'+
      missing+
      '<button class="primary" type="submit" '+(STATE.savingProfile ? 'disabled' : '')+'>'+esc(STATE.savingProfile ? p.saving : p.save)+'</button>'+
    '</form>';
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>'"]/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];
    });
  }
  function safeJsonParse(v, fallback) {
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }
  function decodeJwtPayload(token) {
    try {
      var p = String(token || '').split('.');
      if (p.length < 2) return null;
      var b = p[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(atob(b));
    } catch (e) { return null; }
  }
  function tokenExpiry(token) {
    var p = decodeJwtPayload(token);
    return p && p.exp ? Number(p.exp) : 0;
  }
  function isJwtLike(token) {
    return !!token && typeof token === 'string' && token.split('.').length === 3 && !!decodeJwtPayload(token);
  }
  function tokenUsable(token) {
    if (!isJwtLike(token)) return false;
    var exp = tokenExpiry(token);
    return !!exp && exp * 1000 > Date.now() + 15000;
  }
  function cleanDisplayName(v, fallback) {
    var s = String(v || '').trim();
    if (!s || /[�]/.test(s) || /Ã|Â|ì|í|ë|ê|ð/.test(s)) return fallback || 'Member';
    return s;
  }
  function normalizeRole(v) { return String(v || '').trim().toLowerCase().replace(/[\s.]+/g, '_'); }
  function unique(arr) {
    var map = {};
    return (arr || []).map(normalizeRole).filter(function (x) {
      if (!x || map[x]) return false;
      map[x] = true;
      return true;
    });
  }
  function roleLevel(role) {
    var normalized = normalizeRole(role);
    if (ROLE_LEVEL[normalized] != null) return ROLE_LEVEL[normalized];
    if (normalized.indexOf('site_manager_') === 0) return 12;
    return 0;
  }
  function highestRole(roles) {
    roles = unique(roles);
    if (!roles.length) return 'guest';
    return roles.sort(function (a,b) { return roleLevel(b) - roleLevel(a); })[0];
  }
  function isManagerRole(role) {
    role = normalizeRole(role);
    return role === 'owner' || role === 'admin' || role === 'super_admin' || role === 'director' || role === 'coordinator_director' || role === 'site_manager' || role === 'site_manager_director' || role.indexOf('site_manager_') === 0;
  }
  function canAdmin(roles) {
    roles = unique(roles);
    return roles.some(isManagerRole);
  }
  // System diagnostics are intentionally limited to owner/admin classes.
  // The API repeats this check on the server; this only controls visible UI.
  function canRunSystemDiagnostic(roles) {
    var role = highestRole(roles || []);
    return role === 'owner' || role === 'admin' || role === 'super_admin';
  }
  // Notices are platform-wide communications, so publication is limited to
  // owner/admin classes. Site managers may reply only within their server scope.
  function canPublishNotices(roles) {
    var role = highestRole(roles || []);
    return role === 'owner' || role === 'admin' || role === 'super_admin';
  }
  function managerRole(roles) {
    roles = unique(roles).filter(isManagerRole);
    return highestRole(roles);
  }
  function isAutoManagedRole(role) {
    role = normalizeRole(role);
    return role === 'guest' || role === 'member' || role === 'member_standard' || role === 'member_premium';
  }
  function isProtectedMember(member) {
    var state = member && member.role_state || {};
    var role = normalizeRole(member && (member.role || highestRole(member.roles || [])));
    return !!(member && (member.protected_account || state.protected_account || role === 'owner' || role === 'admin' || role === 'super_admin'));
  }
  function memberForRow(row) {
    if (!row) return null;
    var userId = row.getAttribute('data-user-id');
    return (STATE.members || []).filter(function (member) {
      return String(member.user_id || member.id || '') === String(userId || '');
    })[0] || null;
  }
  function canViewOrManageRole(myRoles, targetRoles) {
    var mine = managerRole(myRoles);
    if (!isManagerRole(mine)) return false;
    var target = highestRole(targetRoles || []);
    if (mine === 'owner') return true;
    if (mine === 'admin' || mine === 'super_admin') return target !== 'owner';
    return roleLevel(target) < roleLevel(mine);
  }
  function canAssignRole(myRoles, targetRole) {
    var mine = managerRole(myRoles);
    targetRole = normalizeRole(targetRole);
    if (!isManagerRole(mine)) return false;
    var scope = currentManagementScope();
    if (scope.kind === 'site_only_below') return siteScopeCanAssignRole(scope, targetRole);
    if (mine === 'owner') return true;
    if (mine === 'admin' || mine === 'super_admin') return targetRole !== 'owner';
    return roleLevel(targetRole) < roleLevel(mine);
  }
  function uniqueSiteKeys(values) {
    var out = [], seen = {};
    function add(value) {
      var key = String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
      if (!key || seen[key]) return;
      seen[key] = true; out.push(key);
    }
    function read(value) {
      if (Array.isArray(value)) { value.forEach(read); return; }
      if (typeof value === 'string') { value.split(',').forEach(add); return; }
      if (value && typeof value === 'object') {
        if (value.site_key || value.site || value.key || value.id) { add(value.site_key || value.site || value.key || value.id); return; }
        Object.keys(value).forEach(function (key) { if (value[key] === true || value[key] === 1 || value[key] === 'true') add(key); });
        return;
      }
      if (value !== undefined && value !== null) add(value);
    }
    read(values); return out;
  }
  function sharesSiteKeys(left, right) {
    var lookup = {}; uniqueSiteKeys(left || []).forEach(function (key) { lookup[key] = true; });
    return uniqueSiteKeys(right || []).some(function (key) { return !!lookup[key]; });
  }
  function currentManagementScope() {
    return (STATE.me && STATE.me.management_scope) || {};
  }
  function memberSiteKeys(member) {
    return uniqueSiteKeys(member && (member.site_keys || member.siteKeys || (member.app_metadata && (member.app_metadata.site_keys || member.app_metadata.igdc_site_keys))));
  }
  function globalCommonMember(member) {
    var role = normalizeRole(member && (member.role || highestRole(member.roles || [])));
    return roleLevel(role) <= roleLevel('commerce_manager') && memberSiteKeys(member).length === 0;
  }
  function siteKeyFromManagerRole(role) {
    var normalized = normalizeRole(role);
    if (!/^site_manager_[a-z0-9_]+_(?:om|op)$/.test(normalized)) return '';
    return normalized.replace(/^site_manager_/, '').replace(/_(?:om|op)$/, '');
  }
  function siteOperationalManagerRole(role) {
    return /^site_manager_[a-z0-9_]+_(?:om|op)$/.test(normalizeRole(role));
  }
  function sameSiteLowerOperationalMember(scope, member) {
    var role = normalizeRole(member && (member.role || highestRole(member.roles || [])));
    if (!siteOperationalManagerRole(role)) return false;
    if (roleLevel(role) >= Number(scope.level || 0)) return false;
    var scopeSites = scope.site_keys || (STATE.me && STATE.me.site_keys) || [];
    return sharesSiteKeys(scopeSites, memberSiteKeys(member)) && sharesSiteKeys(scopeSites, [siteKeyFromManagerRole(role)]);
  }
  function siteScopeCanAssignRole(scope, targetRole) {
    var role = normalizeRole(targetRole);
    if (!siteOperationalManagerRole(role)) return false;
    if (roleLevel(role) >= Number(scope.level || 0)) return false;
    return sharesSiteKeys(scope.site_keys || (STATE.me && STATE.me.site_keys) || [], [siteKeyFromManagerRole(role)]);
  }
  function canViewMember(myRoles, member) {
    var roles = unique(member && (member.roles || (member.app_metadata && member.app_metadata.roles) || []));
    if (!canViewOrManageRole(myRoles, roles)) return false;
    var scope = currentManagementScope();
    if (scope.kind !== 'site_only_below') return true;
    return globalCommonMember(member) || sameSiteLowerOperationalMember(scope, member);
  }
  function canManageMember(myRoles, member) {
    var roles = unique(member && (member.roles || (member.app_metadata && member.app_metadata.roles) || []));
    if (!canViewOrManageRole(myRoles, roles)) return false;
    var scope = currentManagementScope();
    if (scope.kind !== 'site_only_below') return true;
    // Global consumer tiers are directory-only. Site managers only act on
    // same-site OM/OP accounts below their own rank.
    return sameSiteLowerOperationalMember(scope, member);
  }
  function canReviewSiteScopedDoc(doc) {
    var scope = currentManagementScope();
    if (scope.kind !== 'site_only_below') return true;
    var role = normalizeRole((doc && (doc.submitted_role || doc.role)) || highestRole(docRoles(doc)));
    if (!siteOperationalManagerRole(role) || roleLevel(role) >= Number(scope.level || 0)) return false;
    var scopeSites = scope.site_keys || (STATE.me && STATE.me.site_keys) || [];
    return sharesSiteKeys(scopeSites, uniqueSiteKeys(doc && (doc.submitted_site_keys || doc.site_keys || doc.siteKeys))) &&
      sharesSiteKeys(scopeSites, [siteKeyFromManagerRole(role)]);
  }
  function roleEngineRole() {
    try { if (typeof window.getUserRole === 'function') return window.getUserRole(); } catch (e) {}
    return '';
  }
  function roleEngineHas(perm) {
    try {
      if (!window.IGDC_ROLE_PERM || typeof window.IGDC_ROLE_PERM.hasPermission !== 'function') return false;
      return window.IGDC_ROLE_PERM.hasPermission(roleEngineRole(), window.IGDC_ROLE_PERM.PERMISSIONS[perm]);
    } catch (e) { return false; }
  }

  function roleTextCandidate(v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    var n = normalizeRole(v);
    if (!n || n === 'guest' || n === 'os-login' || n === 'os_login' || n === 'login' || n === 'logout' || n === 'log_out' || n === '로그인' || n === '로그아웃' || n === '회원전용' || n === 'members_only') return '';
    if (ROLE_LEVEL[n] || n.indexOf('site_manager') === 0 || n.indexOf('member') === 0 || n === 'owner' || n === 'admin' || n === 'director') return n;
    return '';
  }
  function pushRoleValue(list, v) {
    var n = roleTextCandidate(v);
    if (n) list.push(n);
  }
  function visibleHeaderRoles() {
    var roles = [];
    function pushTextById(id) {
      try {
        var el = document.getElementById(id);
        if (el && el.textContent) pushRoleValue(roles, el.textContent);
        if (el) {
          pushRoleValue(roles, el.getAttribute('data-role-base'));
          pushRoleValue(roles, el.getAttribute('data-current-role'));
          pushRoleValue(roles, el.getAttribute('data-igdc-role'));
        }
      } catch (e) {}
    }
    pushTextById('igtcRoleText3');
    pushTextById('roleStatusBtn');
    pushTextById('igtcRoleInline3');
    pushTextById('userRole');
    try {
      var login = document.getElementById('osLoginBtn');
      if (login && login.nextElementSibling) pushRoleValue(roles, login.nextElementSibling.textContent);
    } catch (e) {}
    try {
      var roleNodes = document.querySelectorAll('[data-role-base], [data-current-role], [data-igdc-role], .role-display');
      Array.prototype.forEach.call(roleNodes, function (el) {
        pushRoleValue(roles, el.getAttribute('data-role-base'));
        pushRoleValue(roles, el.getAttribute('data-current-role'));
        pushRoleValue(roles, el.getAttribute('data-igdc-role'));
        if (el.textContent) pushRoleValue(roles, el.textContent);
      });
    } catch (e) {}
    if (!roles.length) {
      try {
        Array.prototype.forEach.call(document.querySelectorAll('button,span,div'), function (el) {
          var r = el.getBoundingClientRect();
          if (r.top < 130 && r.left < 420 && r.width < 280 && r.height < 80) pushRoleValue(roles, el.textContent);
        });
      } catch (e) {}
    }
    return unique(roles);
  }

  function readRoles() {
    try {
      if (window.IGDCMemberAuth) {
        if (!window.IGDCMemberAuth.isAuthenticated || !window.IGDCMemberAuth.isAuthenticated()) return [];
        if (typeof window.IGDCMemberAuth.getRoles === 'function') return unique(window.IGDCMemberAuth.getRoles());
      }
    } catch (e) {}
    if (!hasValidToken()) return [];
    var roles = [];
    try {
      if (window.osAuth && typeof window.osAuth.getIdTokenPayload === 'function') {
        var payload = window.osAuth.getIdTokenPayload() || {};
        var keys = [cfg().rolesClaim, 'https://igdcglobal.com/roles', 'https://os.auth/roles', 'https://os0.app/roles', 'https://example.com/roles', 'https://osu/roles', 'roles', 'role', 'permissions'];
        keys.forEach(function (key) {
          if (!key) return;
          var value = payload[key];
          if (Array.isArray(value)) roles = roles.concat(value);
          else if (typeof value === 'string') roles = roles.concat(value.split(','));
        });
      }
    } catch (e) {}
    return unique(roles);
  }
  function hasPlatformRole() {
    var roles = readRoles();
    return roles.length > 0 && roles.indexOf('guest') === -1;
  }
  function hasKnownSession() {
    try { if (window.osAuth && typeof window.osAuth.isAuthenticated === 'function' && window.osAuth.isAuthenticated()) return true; } catch (e) {}
    if (hasValidToken()) return true;
    return hasPlatformRole();
  }
  function readStorageItem(key) {
    try { return localStorage.getItem(key) || sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function activeToken() {
    var candidates = [];
    try {
      if (window.osAuth && typeof window.osAuth.getIdTokenClaims === 'function') {
        var c = window.osAuth.getIdTokenClaims();
        if (c) candidates.push(c.__raw || c.raw || c.id_token);
      }
    } catch (e) {}
    try { if (window.osAuth && typeof window.osAuth.getIdToken === 'function') candidates.push(window.osAuth.getIdToken()); } catch (e) {}
    try {
      var tok = storedTokens();
      if (tok) {
        candidates.push(tok.id_token);
        candidates.push(tok.idToken);
        candidates.push(tok.__raw);
        candidates.push(tok.raw);
        candidates.push(tok.access_token);
      }
      candidates.push(readStorageItem('igdc_id_token'));
      candidates.push(readStorageItem('id_token'));
      candidates.push(readStorageItem('auth0_id_token'));
      candidates.push(readStorageItem('igdc_access_token'));
      candidates.push(readStorageItem('access_token'));
    } catch (e) {}
    for (var i = 0; i < candidates.length; i++) {
      if (tokenUsable(candidates[i])) return candidates[i];
    }
    return '';
  }
  function isLoggedIn() { return hasKnownSession(); }
  function storedTokens() {
    var keys = ['osauth.tokens.v2', 'igdc.tokens', 'igdc_auth_tokens', 'auth0_tokens', 'auth0spa'];
    var stores = [];
    try { stores.push(localStorage); } catch (e) {}
    try { stores.push(sessionStorage); } catch (e) {}
    for (var sidx = 0; sidx < stores.length; sidx++) {
      for (var i = 0; i < keys.length; i++) {
        try {
          var raw = stores[sidx].getItem(keys[i]);
          if (!raw) continue;
          var data = safeJsonParse(raw, null);
          if (data && (data.id_token || data.idToken || data.access_token || data.__raw || data.raw)) return data;
        } catch (e) {}
      }
    }
    return null;
  }
  function idToken() { return activeToken(); }
  function hasValidToken() { return !!activeToken(); }
  function userProfile() {
    var p = {};
    try { if (window.osAuth && typeof window.osAuth.getUser === 'function') p = window.osAuth.getUser() || {}; } catch (e) {}
    try { if (!p.email && window.osAuth && typeof window.osAuth.getIdTokenPayload === 'function') p = window.osAuth.getIdTokenPayload() || p; } catch (e) {}
    var roles = readRoles();
    var email = p.email || '';
    var display = cleanDisplayName(p.name || p.nickname || '', '');
    if (!display || normalizeRole(display) === normalizeRole(email)) display = '';
    return {
      name: display || email || 'Member',
      email: email,
      user_id: p.sub || p.user_id || '',
      roles: roles,
      role: highestRole(roles),
      admin: canAdmin(roles)
    };
  }
  function openLogin(force) {
    if (!force && hasValidToken()) {
      try { if (window.IGDCMemberAdminModal && typeof window.IGDCMemberAdminModal.open === 'function') { window.IGDCMemberAdminModal.open('member-home'); return; } } catch (e) {}
      return;
    }
    try {
      if (window.IGDCMemberAuth && typeof window.IGDCMemberAuth.beginLogin === 'function') {
        window.IGDCMemberAuth.beginLogin();
        return;
      }
    } catch (e) {}
    if (typeof window.osLogin === 'function') { window.osLogin(); return; }
    if (typeof window.loginWithRedirect === 'function') { window.loginWithRedirect(); return; }
    try { document.dispatchEvent(new CustomEvent('igdc:login-request')); } catch (e) {}
  }
  /* Member and delegated administration stay inside this modal.
     `member-page` is an internal modal tab; no separate member.html route exists. */
  function targetPage() { return canAdmin(readRoles()) ? (cfg().adminPage || 'admin.html') : ''; }
  function openTarget() {
    if (!canAdmin(readRoles())) { setTab('member-page'); return; }
    var frame = document.getElementById('mainFrame') || document.querySelector('iframe[name="mainFrame"]');
    var page = targetPage();
    if (!page) { setTab('member-page'); return; }
    close();
    if (frame) frame.src = page;
    else window.location.href = page;
  }
  function headers() {
    var h = {'Content-Type':'application/json'};
    var tok = idToken();
    if (tok) h.Authorization = 'Bearer ' + tok;
    return h;
  }
  function apiGet(params) {
    var q = new URLSearchParams(params || {}).toString();
    return fetch(apiBase() + (q ? '?' + q : ''), {method:'GET', credentials:'include', headers:headers()}).then(readJson);
  }
  function apiPost(action, body) {
    body = body || {};
    body.action = action;
    return fetch(apiBase(), {method:'POST', credentials:'include', headers:headers(), body:JSON.stringify(body)}).then(readJson);
  }
  function readJson(res) {
    return res.text().then(function (txt) {
      var data = txt ? safeJsonParse(txt, {ok:false, error:txt}) : {};
      if (!res.ok || data.ok === false) throw new Error(data.error || data.message || ('HTTP ' + res.status));
      return data;
    });
  }
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ''+
      '#'+ROOT_ID+'{position:fixed;inset:0;z-index:2147483645;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111}'+
      '#'+ROOT_ID+'[hidden]{display:none!important}'+
      '#'+ROOT_ID+' .igdc-ma-mask{position:absolute;inset:0;background:rgba(0,0,0,.52)}'+
      '#'+ROOT_ID+' .igdc-ma-modal{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1540px,calc(100vw - 32px));height:min(820px,calc(100vh - 32px));box-sizing:border-box;background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.34);display:flex;overflow:hidden}'+
      '#'+ROOT_ID+' .igdc-ma-side{width:248px;flex:0 0 248px;box-sizing:border-box;min-width:0;background:#0b2440;color:#fff;padding:18px;display:flex;flex-direction:column;gap:10px;overflow:auto}'+
      '#'+ROOT_ID+' .igdc-ma-side h3{font-size:19px;margin:0 0 4px;color:#fff}'+
      '#'+ROOT_ID+' .igdc-ma-side p{font-size:12px;line-height:1.45;margin:0 0 10px;color:#cfe3f7}'+
      '#'+ROOT_ID+' .igdc-ma-tab{display:block;width:100%;text-align:left;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#fff;border-radius:10px;padding:10px;cursor:pointer;font-weight:700}'+
      '#'+ROOT_ID+' .igdc-ma-tab.active{background:#fff;color:#0b2440}'+
      '#'+ROOT_ID+' .igdc-ma-body{flex:1;min-width:0;display:flex;flex-direction:column;background:#f6f8fb}'+
      '#'+ROOT_ID+' .igdc-ma-top{display:flex;justify-content:space-between;align-items:center;gap:10px;min-width:0;background:#fff;border-bottom:1px solid #e5e8ee;padding:14px 18px}'+
      '#'+ROOT_ID+' .igdc-ma-top h2{min-width:0;font-size:20px;margin:0;color:#0b3f74}'+
      '#'+ROOT_ID+' .igdc-ma-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}'+
      '#'+ROOT_ID+' button{border:1px solid #d0d7de;border-radius:9px;padding:7px 10px;background:#fff;cursor:pointer;font-weight:700}'+
      '#'+ROOT_ID+' button.primary{background:#0b74de;color:#fff;border-color:#0b74de}'+
      '#'+ROOT_ID+' button.danger{background:#b42318;color:#fff;border-color:#b42318}'+
      '#'+ROOT_ID+' button:disabled{opacity:.5;cursor:not-allowed}'+
      '#'+ROOT_ID+' .igdc-ma-content{min-width:0;padding:16px 18px;overflow:auto;flex:1}'+
      '#'+ROOT_ID+' .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}'+
      '#'+ROOT_ID+' .card{background:#fff;border:1px solid #e5e8ee;border-radius:14px;padding:14px;box-shadow:0 4px 18px rgba(15,23,42,.04)}'+
      '#'+ROOT_ID+' .card h4{margin:0 0 8px;font-size:15px;color:#0b3f74}'+
      '#'+ROOT_ID+' .muted{color:#667085;font-size:13px;line-height:1.45}'+
      '#'+ROOT_ID+' .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'+
      '#'+ROOT_ID+' input,#'+ROOT_ID+' select,#'+ROOT_ID+' textarea{border:1px solid #d0d7de;border-radius:9px;padding:9px;width:100%;box-sizing:border-box;background:#fff}'+
      '#'+ROOT_ID+' textarea{min-height:110px;resize:vertical}'+
      '#'+ROOT_ID+' table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;table-layout:fixed}'+
      '#'+ROOT_ID+' th,#'+ROOT_ID+' td{border-bottom:1px solid #edf0f5;padding:7px 8px;text-align:left;font-size:13px;vertical-align:middle;line-height:1.3}'+
      '#'+ROOT_ID+' th{background:#eef4fb;color:#0b3f74;font-size:12px;position:sticky;top:0;z-index:1}'+
      '#'+ROOT_ID+' .igdc-ma-member-card{padding:10px 12px!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-tools{margin:8px 0 10px!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-list{border:1px solid #e5e8ee;border-radius:12px;overflow:auto;background:#fff;display:block!important;scrollbar-gutter:stable}'+
      '#'+ROOT_ID+' .igdc-ma-member-head,#'+ROOT_ID+' .igdc-ma-member-row{display:grid!important;grid-template-columns:minmax(190px,1.25fr) minmax(155px,1.05fr) minmax(135px,.85fr) minmax(155px,.9fr) minmax(135px,.9fr)!important;min-width:810px;align-items:center!important;gap:6px!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-head{background:#eef4fb;color:#0b3f74;font-size:12px;font-weight:800;padding:7px 10px!important;min-height:30px!important;line-height:1.2!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-row{padding:5px 10px!important;border-top:1px solid #edf0f5!important;min-height:34px!important;height:auto!important;max-height:none!important;margin:0!important;line-height:1.18!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-row>*{margin:0!important;padding-top:0!important;padding-bottom:0!important;min-height:0!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-row:hover{background:#f8fafc}'+
      '#'+ROOT_ID+' .igdc-ma-member-id{font-size:11.5px!important;line-height:1.18!important;word-break:break-all;color:#344054}'+
      '#'+ROOT_ID+' .igdc-ma-member-name{font-size:12.5px!important;line-height:1.18!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-name .muted{font-size:12px!important;line-height:1.18!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-start}'+
      '#'+ROOT_ID+' .igdc-ma-member-actions button{padding:4px 7px!important;font-size:11.5px!important;border-radius:6px!important;line-height:1.15!important}'+
      '#'+ROOT_ID+' .igdc-ma-member-row select{padding:4px 7px!important;font-size:11.5px!important;border-radius:6px!important;height:30px!important;line-height:1.15!important}'+      '#'+ROOT_ID+' .igdc-ma-review-list{border:1px solid #e5e8ee;border-radius:12px;overflow:auto;background:#fff;display:block!important;scrollbar-gutter:stable}'+
      '#'+ROOT_ID+' .igdc-ma-review-head,#'+ROOT_ID+' .igdc-ma-review-row{display:grid!important;grid-template-columns:minmax(190px,1.2fr) minmax(155px,1fr) minmax(120px,.75fr) minmax(120px,.75fr) minmax(165px,1fr)!important;min-width:780px;align-items:center!important;gap:6px!important}'+
      '#'+ROOT_ID+' .igdc-ma-review-head{background:#eef4fb;color:#0b3f74;font-size:12px;font-weight:800;padding:7px 10px!important;min-height:30px!important;line-height:1.2!important}'+
      '#'+ROOT_ID+' .igdc-ma-review-row{padding:6px 10px!important;border-top:1px solid #edf0f5!important;min-height:36px!important;margin:0!important;line-height:1.2!important}'+
      '#'+ROOT_ID+' .igdc-ma-review-row>*{margin:0!important;padding-top:0!important;padding-bottom:0!important;min-height:0!important}'+
      '#'+ROOT_ID+' .igdc-ma-review-row:hover{background:#f8fafc}'+

      '#'+ROOT_ID+' .badge{display:inline-block;border-radius:999px;background:#eef4fb;color:#0b3f74;padding:2px 7px;margin:1px 2px;font-size:11px;font-weight:700}'+
      '#'+ROOT_ID+' .error{background:#fff1f0;color:#b42318;border:1px solid #ffccc7;border-radius:10px;padding:10px;margin-bottom:10px}'+
      '#'+ROOT_ID+' .igdc-ma-qna-list{display:grid;gap:10px;margin-top:12px}'+
      '#'+ROOT_ID+' .igdc-ma-qna-card{margin:0}'+
      '#'+ROOT_ID+' .igdc-ma-qna-replies-wrap{margin-top:12px;padding-top:10px;border-top:1px solid #edf0f5}'+
      '#'+ROOT_ID+' .igdc-ma-qna-replies{display:grid;gap:8px;margin-top:8px}'+
      '#'+ROOT_ID+' .igdc-ma-qna-reply{background:#f7fbff;border:1px solid #dbeafe;border-radius:10px;padding:9px;white-space:pre-wrap}'+
      '#'+ROOT_ID+' .igdc-ma-qna-reply-form{margin-top:12px;padding-top:12px;border-top:1px solid #edf0f5}'+
      '#'+ROOT_ID+' .igdc-ma-qna-reply-form textarea{min-height:90px;margin-top:6px}'+
      '#'+ROOT_ID+' .igdc-ma-diagnostic-json{margin:12px 0 0;max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#0b1726;color:#e6edf3;border-radius:10px;padding:12px;font-size:12px;line-height:1.4}'+
      '#'+ROOT_ID+' .ok{background:#ecfdf3;color:#027a48;border:1px solid #abefc6;border-radius:10px;padding:10px;margin-bottom:10px}'+
      '@media(max-width:1120px){#'+ROOT_ID+' .igdc-ma-side{width:220px;flex-basis:220px;padding:14px}#'+ROOT_ID+' .igdc-ma-top{padding:12px 14px}#'+ROOT_ID+' .igdc-ma-content{padding:12px 14px}}'+
      '@media(max-width:820px){#'+ROOT_ID+' .igdc-ma-modal{width:calc(100vw - 20px);height:calc(100vh - 20px);flex-direction:column}#'+ROOT_ID+' .igdc-ma-side{width:auto;flex:0 0 auto;max-height:190px;padding:14px;overflow:auto}#'+ROOT_ID+' .grid{grid-template-columns:1fr}#'+ROOT_ID+' .igdc-ma-member-head{display:none!important}#'+ROOT_ID+' .igdc-ma-member-row{min-width:0;grid-template-columns:1fr!important;gap:5px!important}#'+ROOT_ID+' .igdc-ma-review-head{display:none!important}#'+ROOT_ID+' .igdc-ma-review-row{min-width:0;grid-template-columns:1fr!important;gap:5px!important}#'+ROOT_ID+' th:nth-child(1),#'+ROOT_ID+' td:nth-child(1){display:none}}';
    document.head.appendChild(style);
  }
  function root() {
    ensureStyle();
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = ROOT_ID;
    el.hidden = true;
    el.innerHTML = '<div class="igdc-ma-mask" data-close></div><section class="igdc-ma-modal" role="dialog" aria-modal="true" aria-labelledby="igdc-member-admin-title"></section>';
    document.body.appendChild(el);
    el.addEventListener('click', handleClick);
    el.addEventListener('change', handleChange);
    el.addEventListener('submit', handleSubmit);
    return el;
  }
  function setTab(tab) {
    STATE.tab = tab;
    render();
    if (tab === 'member-page') loadMyReviewDocs();
    if (tab === 'member-profile') loadMemberProfile();
    if (tab === 'question') loadMyQuestions();
    if (tab === 'notice') loadNotices();
    if (tab === 'admin-members') loadMembers();
    if (tab === 'admin-queue') loadReviewDocs();
    if (tab === 'admin-notice') { loadAdminQuestions(); loadNotices(); }
    if (tab === 'admin-diagnostic' && canRunSystemDiagnostic((STATE.me && STATE.me.roles) || readRoles())) loadSystemDiagnostic();
  }
  function setError(msg) { STATE.error = msg || ''; render(); }
  function render() {
    var el = root();
    var modal = el.querySelector('.igdc-ma-modal');
    var me = STATE.me || userProfile();
    var labels = t();
    var admin = !!me.admin;
    modal.innerHTML = sideHtml(labels, me, admin) + bodyHtml(labels, me, admin);
  }
  function sideHtml(labels, me, admin) {
    function tab(id, text, adminOnly) {
      if (adminOnly && !admin) return '';
      return '<button type="button" class="igdc-ma-tab '+(STATE.tab===id?'active':'')+'" data-tab="'+id+'">'+esc(text)+'</button>';
    }
    return '<aside class="igdc-ma-side">'+
      '<h3 id="igdc-member-admin-title">'+esc(labels.title)+'</h3>'+
      '<p>'+esc(labels.desc)+'</p>'+
      '<p><b>'+esc(me.name || me.email || me.user_id || 'Member')+'</b>'+((me.email && normalizeRole(me.email)!==normalizeRole(me.name))?'<br>'+esc(me.email):'')+(!me.email && me.user_id?'<br>'+esc(me.user_id):'')+'<br><span class="badge">'+esc(me.role || 'guest')+'</span></p>'+
      tab('member-home', labels.tabs.memberHome) +
      tab('submit', labels.tabs.submit) +
      tab('question', labels.tabs.question) +
      tab('notice', labels.tabs.notice) +
      tab('admin-members', labels.tabs.adminMembers, true) +
      tab('admin-queue', labels.tabs.adminQueue, true) +
      tab('admin-notice', labels.tabs.adminNotice, true) +
      (canRunSystemDiagnostic((me && me.roles) || readRoles()) ? tab('admin-diagnostic', labels.tabs.adminDiagnostic, false) : '') +
    '</aside>';
  }
  function bodyHtml(labels, me, admin) {
    var loginAction = !(hasKnownSession() || (me && me.role && me.role !== 'guest'))
      ? '<button type="button" class="primary" data-action="login">'+esc(labels.login)+'</button>'
      : (!hasValidToken() ? '<button type="button" data-action="login">'+esc(labels.renew || '세션 갱신')+'</button>' : '');
    var adminAction = admin
      ? '<button type="button" data-action="open-page">'+esc(labels.adminPage)+'</button>'
      : '';
    return '<main class="igdc-ma-body">'+
      '<div class="igdc-ma-top"><div><h2>'+esc(titleForTab(labels))+'</h2><div class="muted">IGDC Member/Admin Modal v'+VERSION+'</div></div>'+
      '<div class="igdc-ma-actions">'+loginAction+adminAction+
        '<button type="button" data-close>'+esc(labels.close)+'</button>'+
      '</div></div>'+
      '<div class="igdc-ma-content">'+
        (STATE.error ? '<div class="error">'+esc(STATE.error)+'</div>' : '')+
        renderTab(labels, me, admin)+
      '</div></main>';
  }
  function titleForTab(labels) {
    var m = labels.tabs;
    return ({'member-home':m.memberHome,'member-page':m.memberPage || uiText().memberPageTitle,'member-profile':profileText().title,'submit':m.submit,'question':m.question,'notice':m.notice,'admin-members':m.adminMembers,'admin-queue':m.adminQueue,'admin-notice':m.adminNotice,'admin-diagnostic':m.adminDiagnostic})[STATE.tab] || m.memberHome;
  }
  function renderTab(labels, me, admin) {
    if (STATE.tab.indexOf('admin-') === 0 && !admin) return '<div class="card"><h4>'+esc(labels.noAccess)+'</h4></div>';
    if (STATE.tab === 'admin-diagnostic' && !canRunSystemDiagnostic((me && me.roles) || readRoles())) return '<div class="card"><h4>'+esc(uiText().diagnosticNotAllowed)+'</h4></div>';
    if (STATE.tab === 'member-home') return memberHomeHtml(me);
    if (STATE.tab === 'member-profile') return memberProfileHtml(me);
    if (STATE.tab === 'member-page') return memberPageHtml(me, admin);
    if (STATE.tab === 'submit') return submitHtml();
    if (STATE.tab === 'question') return questionHtml(admin);
    if (STATE.tab === 'notice') return noticeHtml(admin);
    if (STATE.tab === 'admin-members') return adminMembersHtml(labels);
    if (STATE.tab === 'admin-queue') return adminQueueHtml(labels);
    if (STATE.tab === 'admin-notice') return adminNoticeHtml();
    if (STATE.tab === 'admin-diagnostic') return systemDiagnosticHtml(me);
    return '';
  }
  function memberHomeHtml(me) {
    var u = uiText();
    var p = profileText();
    var role = membershipRole(me);
    var signedIn = hasKnownSession() || (me && me.role && me.role !== 'guest');
    if (!signedIn) {
      return '<div class="grid"><div class="card"><h4>'+esc(u.loginTitle)+'</h4><div class="muted">'+esc(u.loginDesc)+'</div><br><button class="primary" data-action="login">'+esc(t().login)+'</button></div></div>';
    }
    var editProfile = role !== 'member' && role !== 'guest';
    var profileAction = '<button class="primary" data-action="open-member-profile">'+esc(editProfile ? p.edit : p.upgrade)+'</button>';
    var profileState = me && me.profile_status || {};
    var profileHint = '';
    if (role === 'member' && profileState.standard_eligible) profileHint = '<br><span class="muted">'+esc(p.pending)+'</span>';
    var canCommerce = roleEngineHas('APPLY_COMMERCE') || roleLevel(me.role) >= 3;
    return '<div class="grid">'+
      '<div class="card"><h4>'+esc(u.memberStatusTitle)+'</h4><div class="muted">'+esc(u.currentRole)+': <b>'+esc(membershipRoleLabel(role))+'</b>'+profileHint+'</div><br>'+profileAction+'</div>'+
      '<div class="card"><h4>'+esc(u.premiumTitle)+'</h4><div class="muted">'+esc(u.premiumDesc)+'</div></div>'+
      '<div class="card"><h4>'+esc(u.commerceTitle)+'</h4><div class="muted">'+esc(u.commerceDesc)+'</div><br><button '+(!canCommerce?'disabled':'')+' data-action="request-upgrade" data-role="commerce">'+esc(u.commerceApply)+'</button></div>'+
      '<div class="card"><h4>'+esc(u.memberPageTitle)+'</h4><div class="muted">'+esc(u.memberPageDesc)+'</div><br><button data-tab="member-page">'+esc(u.openMemberPage)+'</button></div>'+
      (me.admin ? '<div class="card"><h4>'+esc(u.adminMembersTitle)+'</h4><div class="muted">'+esc(u.adminMembersDesc)+'</div><br><button class="primary" data-tab="admin-members">'+esc(u.openMembers)+'</button> <button data-tab="admin-queue">'+esc(u.openReview)+'</button></div>' : '')+
      '<div class="card"><h4>'+esc(u.loginStateTitle)+'</h4><div class="muted">'+esc(u.siteRole)+': <b>'+esc(displayRoleLabel(me))+'</b><br>'+(hasValidToken()?esc(u.tokenOk):esc(u.tokenMissing))+'</div>'+(hasValidToken()?'':'<br><button data-action="login">'+esc(u.renewSession)+'</button>')+'</div>'+
    '</div>';
  }
  function memberPageHtml(me, admin) {
    var u = uiText();
    var profile = '<div class="card"><h4>'+esc(u.memberPageTitle)+'</h4>'+      '<div class="muted">'+esc(u.memberPageDesc)+'</div><br>'+      '<div class="muted"><b>'+esc(me.name || me.email || 'Member')+'</b><br>'+      (me.email ? esc(me.email)+'<br>' : '')+      (me.user_id ? 'User ID: '+esc(me.user_id)+'<br>' : '')+      esc(u.currentRole)+': <span class="badge">'+esc(displayRoleLabel(me))+'</span></div></div>';
    var shortcuts = '<div class="card"><h4>회원 메뉴</h4><div class="row">'+      '<button data-tab="submit">'+esc(t().tabs.submit)+'</button>'+      '<button data-tab="question">'+esc(t().tabs.question)+'</button>'+      '<button data-tab="notice">'+esc(t().tabs.notice)+'</button>'+      (admin ? '<button class="primary" data-tab="admin-members">'+esc(u.openMembers)+'</button>' : '')+      '</div></div>';
    var docs = (STATE.myReviewDocs || []).map(function (doc) {
      var id = doc.id || doc.document_id || '';
      var target = doc.target_role || doc.requested_role || '-';
      var when = doc.reviewed_at || doc.updated_at || doc.submitted_at || doc.created_at || '';
      var note = doc.review_note ? '<br><span class="muted">'+esc(doc.review_note)+'</span>' : '';
      var attachments = Array.isArray(doc.attachments || doc.files) ? (doc.attachments || doc.files) : [];
      var canOpen = attachments.some(function(file) { return String(file.upload_status || 'uploaded') === 'uploaded'; });
      return '<div class="igdc-ma-review-row" data-review-id="'+esc(id)+'">'+
        '<div><b>'+esc(doc.title || u.reviewDocDefault)+'</b>'+note+'</div>'+ 
        '<div>'+esc(target)+'</div>'+ 
        '<div><span class="badge">'+esc(doc.status || 'pending')+'</span><br><span class="muted">'+esc(when)+'</span></div>'+
        '<div class="igdc-ma-member-actions">'+(canOpen ? '<button data-action="open-review-doc">'+esc(u.myReviewOpen)+'</button>' : '')+'</div>'+
      '</div>';
    }).join('');
    var myStatus = '<div class="card igdc-ma-member-card"><div class="row" style="justify-content:space-between"><h4>'+esc(u.myReviewTitle)+'</h4><button data-action="reload-my-review">'+esc(u.myReviewReload)+'</button></div>'+ 
      '<div class="muted" style="margin-bottom:8px">'+esc(u.myReviewDesc)+'</div>'+
      (STATE.loadingMyReview ? '<div class="muted">'+esc(t().loading)+'</div>' : '')+
      '<div class="igdc-ma-review-list">'+
        '<div class="igdc-ma-review-head" style="grid-template-columns:minmax(230px,1.4fr) minmax(120px,.8fr) minmax(160px,.9fr) minmax(140px,.7fr)!important"><div>'+esc(u.reviewHeadDoc)+'</div><div>'+esc(u.reviewHeadTarget)+'</div><div>'+esc(u.reviewHeadStatus)+'</div><div>'+esc(u.open)+'</div></div>'+ 
        (docs || '<div class="igdc-ma-review-row" style="grid-template-columns:1fr!important"><div class="muted">'+esc(u.myReviewNone)+'</div></div>')+
      '</div></div>';
    return '<div class="grid">'+profile+shortcuts+'</div>'+myStatus;
  }

  function submitHtml() {
    var u = uiText();
    var selected = normalizeRole(STATE.requestedRole || '');
    function option(value, label) { return '<option value="'+esc(value)+'" '+(selected === value ? 'selected' : '')+'>'+esc(label)+'</option>'; }
    return '<form class="card" data-form="document-submit"><h4>'+esc(u.submitTitle)+'</h4><div class="muted">'+esc(u.submitDesc)+'</div><br>'+
      '<label>'+esc(u.requestedRoleLabel)+'<select name="requested_role">'+
        option('', u.requestedRoleNone)+option('commerce', u.requestedRoleCommerce)+
      '</select></label><br><br>'+
      '<label>'+esc(u.titleLabel)+'<input name="title" required placeholder="'+esc(u.submitTitlePlaceholder)+'"></label><br><br>'+
      '<label>'+esc(u.bodyLabel)+'<textarea name="body" required placeholder="'+esc(u.submitBodyPlaceholder)+'"></textarea></label><br><br>'+
      '<label>'+esc(u.attachmentLabel)+'<input name="files" type="file" multiple></label><div class="muted" style="margin-top:6px">'+esc(u.attachmentHelp)+'</div><br>'+
      '<button class="primary" type="submit">'+esc(u.submitButton)+'</button></form>';
  }
  function qnaStatusLabel(status, u) {
    var key = String(status || 'open').toLowerCase();
    if (key === 'answered') return u.questionStatusAnswered || 'Answered';
    if (key === 'closed') return u.questionStatusClosed || 'Closed';
    return u.questionStatusOpen || 'Received';
  }
  function qnaRepliesHtml(question, u) {
    var replies = Array.isArray(question && question.replies) ? question.replies : [];
    if (!replies.length) return '<div class="muted" style="margin-top:8px">'+esc(u.noReplies)+'</div>';
    return '<div class="igdc-ma-qna-replies">'+replies.map(function (reply) {
      return '<div class="igdc-ma-qna-reply"><b>'+esc(reply.responder_name || reply.responder_role || 'Admin')+'</b><span class="badge">'+esc(reply.responder_role || 'admin')+'</span><br><span>'+esc(reply.body || '')+'</span><br><span class="muted">'+esc(reply.created_at || '')+'</span></div>';
    }).join('')+'</div>';
  }
  function qnaQuestionCardHtml(question, u, showSubmitter, replyForm) {
    var submitter = showSubmitter ? '<div class="muted" style="margin-top:5px">'+esc(question.user_name || question.user_email || question.user_id || '')+' · '+esc(question.submitted_role || 'guest')+'</div>' : '';
    var form = replyForm ? '<form class="igdc-ma-qna-reply-form" data-form="admin-reply"><input type="hidden" name="question_id" value="'+esc(question.id || question.question_id || '')+'"><label>'+esc(u.replyLabel)+'<textarea name="body" required placeholder="'+esc(u.replyPlaceholder)+'"></textarea></label><br><button class="primary" type="submit">'+esc(u.replyButton)+'</button></form>' : '';
    return '<article class="card igdc-ma-qna-card"><div class="row" style="justify-content:space-between;align-items:flex-start"><h4>'+esc(question.title || u.questionTitle)+'</h4><span class="badge">'+esc(qnaStatusLabel(question.status, u))+'</span></div>'+submitter+
      '<div style="white-space:pre-wrap;margin-top:9px">'+esc(question.body || '')+'</div><div class="muted" style="margin-top:8px">'+esc(question.created_at || '')+'</div>'+
      '<div class="igdc-ma-qna-replies-wrap"><b>'+esc(u.repliesTitle)+'</b>'+qnaRepliesHtml(question,u)+'</div>'+form+'</article>';
  }
  function questionHtml(admin) {
    var u = uiText();
    var questions = (STATE.questions || []).map(function (question) { return qnaQuestionCardHtml(question, u, false, false); }).join('');
    return '<form class="card" data-form="question-submit"><h4>'+esc(u.questionTitle)+'</h4><div class="muted">'+esc(u.questionDesc)+'</div><br>'+
      '<label>'+esc(u.qTitleLabel)+'<input name="title" required placeholder="'+esc(u.qTitlePlaceholder)+'"></label><br><br>'+
      '<label>'+esc(u.qBodyLabel)+'<textarea name="body" required placeholder="'+esc(u.qBodyPlaceholder)+'"></textarea></label><br><br>'+
      '<button class="primary" type="submit">'+esc(u.qButton)+'</button> '+(admin?'<button type="button" data-tab="admin-notice">'+esc(u.openReplyAdmin)+'</button>':'')+'</form>'+
      '<section class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between"><h4>'+esc(u.myQuestionsTitle)+'</h4><button data-action="reload-my-questions">'+esc(u.myQuestionsReload)+'</button></div><div class="muted">'+esc(u.myQuestionsDesc)+'</div>'+
      (STATE.loadingQuestions ? '<div class="muted" style="margin-top:8px">'+esc(t().loading)+'</div>' : '')+
      '<div class="igdc-ma-qna-list">'+(questions || '<div class="muted" style="margin-top:12px">'+esc(u.myQuestionsNone)+'</div>')+'</div></section>';
  }
  function noticeHtml(admin) {
    var u = uiText();
    var notices = (STATE.notices || []).map(function (notice) {
      return '<article class="card igdc-ma-qna-card"><h4>'+esc(notice.title || u.noticeTitle)+'</h4><div style="white-space:pre-wrap">'+esc(notice.body || '')+'</div><div class="muted" style="margin-top:8px">'+esc(u.publishedAt)+': '+esc(notice.published_at || notice.created_at || '')+'</div></article>';
    }).join('');
    return '<section class="card"><div class="row" style="justify-content:space-between"><h4>'+esc(u.noticeTitle)+'</h4><button data-action="reload-notices">'+esc(u.noticesReload)+'</button></div><div class="muted">'+esc(u.noticeDesc)+'</div>'+
      (admin?'<br><button data-tab="admin-notice">'+esc(u.manageNotice)+'</button>':'')+
      (STATE.loadingNotices ? '<div class="muted" style="margin-top:8px">'+esc(t().loading)+'</div>' : '')+
      '<div class="igdc-ma-qna-list">'+(notices || '<div class="muted" style="margin-top:12px">'+esc(u.noticesNone)+'</div>')+'</div></section>';
  }
  function rolesForSelect(current) {
    var roles = (cfg().roleOptions || [
      'special_menber',
      'commerce_manager',
      'site_manager_home_om',
      'site_manager_home_op',
      'site_manager_home',
      'site_manager_distribution_om',
      'site_manager_distribution_op',
      'site_manager_distribution',
      'site_manager_mediahub_om',
      'site_manager_mediahub_op',
      'site_manager_mediahub',
      'site_manager_networkhub_om',
      'site_manager_networkhub_op',
      'site_manager_networkhub',
      'site_manager_socialnetwork_om',
      'site_manager_socialnetwork_op',
      'site_manager_socialnetwork',
      'site_manager_tour_om',
      'site_manager_tour_op',
      'site_manager_tour',
      'site_manager_donation_om',
      'site_manager_donation_op',
      'site_manager_donation',
      'coordinator_director',
      'director',
      'admin',
      'owner'
    ]);
    var myRoles = (STATE.me && STATE.me.roles) || readRoles();
    var currentRole = normalizeRole(current);
    var filtered = roles.filter(function (role) {
      return !isAutoManagedRole(role) && canAssignRole(myRoles, role);
    });
    if (currentRole && !isAutoManagedRole(currentRole) && filtered.map(normalizeRole).indexOf(currentRole) < 0 && canAssignRole(myRoles, currentRole)) {
      filtered.unshift(currentRole);
    }
    var prompt = uiText().selectSpecialRole || 'Select special role';
    var options = '<option value="" '+(isAutoManagedRole(currentRole) ? 'selected' : '')+'>'+esc(prompt)+'</option>';
    return options + filtered.map(function (role) {
      return '<option value="'+esc(role)+'" '+(currentRole === normalizeRole(role) ? 'selected' : '')+'>'+esc(role)+'</option>';
    }).join('');
  }

  function roleStateHtml(member) {
    var u = uiText();
    var state = member.role_state || {};
    var effective = normalizeRole(member.role || highestRole(member.roles || [])) || 'guest';
    var source = normalizeRole(state.source_role || effective) || effective;
    var sourceLabel = state.applied_source === 'member_admin'
      ? (u.roleSourceManual || 'Admin exception active')
      : (state.applied_source === 'member_review'
        ? (u.roleSourceReview || 'Membership review approved')
        : (state.manual_override_changed_by_source ? (u.roleSourceReturned || 'OSO change applied') : (u.roleSourceOsO || 'OSO/M2M source')));
    var protection = isProtectedMember(member) ? '<br><span class="badge">'+esc(u.protectedAccount || 'Protected account')+'</span>' : '';
    var blocked = member.blocked ? '<br><span class="badge">blocked</span>' : '';
    return '<span class="badge">'+esc(effective)+'</span><br>'+
      '<span class="muted">'+esc(u.roleSourceOsO || 'OSO/M2M source')+': '+esc(source)+'</span><br>'+
      '<span class="muted">'+esc(sourceLabel)+'</span>'+protection+blocked;
  }

  function adminMembersHtml(labels) {
    var u = uiText();
    var myRoles = (STATE.me && STATE.me.roles) || readRoles();
    var visibleMembers = (STATE.members || []).filter(function (member) {
      var roles = unique(member.roles || (member.app_metadata && member.app_metadata.roles) || []);
      return canViewMember(myRoles, member);
    });
    var rows = visibleMembers.map(function (member) {
      var roles = unique(member.roles || (member.app_metadata && member.app_metadata.roles) || []);
      var role = normalizeRole(member.role || highestRole(roles));
      var canManage = canManageMember(myRoles, member);
      var options = rolesForSelect(role);
      var state = member.role_state || {};
      var actions = '';
      if (canManage && options) {
        actions += '<button data-action="save-role">'+esc(u.save)+'</button>';
        if (state.manual_override_active) {
          actions += '<button data-action="clear-role-override">'+esc(u.restoreOsO || 'Restore OSO role')+'</button>';
        }
        if (member.blocked) {
          actions += '<button data-action="unblock-user">'+esc(u.unblock || 'Unblock')+'</button>';
        } else {
          actions += '<button data-action="block-user" class="danger">'+esc(u.block)+'</button>';
        }
      }
      return '<div class="igdc-ma-member-row" data-user-id="'+esc(member.user_id || member.id || '')+'">'+
        '<div class="igdc-ma-member-id">'+esc(member.user_id || '')+'</div>'+
        '<div class="igdc-ma-member-name"><b>'+esc(member.name || member.nickname || '')+'</b><br><span class="muted">'+esc(member.email || '')+'</span></div>'+
        '<div>'+roleStateHtml(member)+'</div>'+
        '<div>'+(canManage && options ? '<select data-role-select>'+options+'</select>' : '<span class="muted">'+esc((currentManagementScope().kind === 'site_only_below' && globalCommonMember(member)) ? (u.viewOnly || u.noPermission) : u.noPermission)+'</span>')+'</div>'+
        '<div class="igdc-ma-member-actions">'+actions+'</div>'+
      '</div>';
    }).join('');
    return '<div class="card igdc-ma-member-card"><div class="row" style="justify-content:space-between"><h4>'+esc(u.adminMembersTitle2)+'</h4><button data-action="reload-members">'+esc(labels.refresh)+'</button></div>'+
      '<div class="muted" style="margin-bottom:8px">'+esc(u.adminMembersDesc2)+'</div>'+
      '<div class="row igdc-ma-member-tools"><input id="igdc-member-search" value="'+esc(STATE.query)+'" placeholder="'+esc(labels.searchPlaceholder)+'"><button data-action="search-members">'+esc(u.search)+'</button></div>'+
      (STATE.loading?'<div class="muted">'+esc(labels.loading)+'</div>':'')+
      '<div class="igdc-ma-member-list">'+
        '<div class="igdc-ma-member-head"><div>User ID</div><div>'+esc(u.colMember)+'</div><div>'+esc(u.colRole)+'</div><div>'+esc(u.colChangeReview)+'</div><div>'+esc(u.colManage)+'</div></div>'+
        (rows || '<div class="igdc-ma-member-row"><div class="muted" style="grid-column:1/-1">'+esc(u.noMembers)+'</div></div>')+
      '</div>'+
      '<div class="row" style="margin-top:8px;justify-content:space-between"><div class="muted">'+esc(u.shown)+' '+esc(visibleMembers.length)+' / '+esc(u.serverQuery)+' '+esc(STATE.total || STATE.members.length)+' / '+esc(u.page)+' '+esc(STATE.page + 1)+'</div><div class="row"><button data-action="prev-members" '+(STATE.page > 0 ? '' : 'disabled')+'>'+esc(u.previous || 'Previous')+'</button><button data-action="next-members" '+(STATE.hasMore ? '' : 'disabled')+'>'+esc(u.next || 'Next')+'</button></div></div></div>';
  }
  function docRoles(doc) {
    return unique(
      doc.roles ||
      doc.user_roles ||
      doc.submitter_roles ||
      doc.current_roles ||
      (doc.user && doc.user.roles) ||
      (doc.app_metadata && doc.app_metadata.roles) ||
      []
    );
  }
  function docTargetRole(doc) {
    return normalizeRole(doc.target_role || doc.requested_role || doc.apply_role || doc.role || '');
  }
  function canReviewDoc(myRoles, doc) {
    var roles = docRoles(doc);
    var target = docTargetRole(doc);
    if (roles.length && !canViewOrManageRole(myRoles, roles)) return false;
    if (target && !canAssignRole(myRoles, target)) return false;
    return canReviewSiteScopedDoc(doc);
  }
  function adminQueueHtml(labels) {
    var u = uiText();
    var myRoles = (STATE.me && STATE.me.roles) || readRoles();
    var docs = (STATE.reviewDocs || []).filter(function (d) { return canReviewDoc(myRoles, d); });
    var rows = docs.map(function (d) {
      var id = d.id || d.document_id || d.review_id || d.submission_id || '';
      var user = d.user || {};
      var email = d.email || user.email || d.user_email || '';
      var name = d.name || user.name || user.nickname || d.user_name || '';
      var title = d.title || d.subject || d.type || u.reviewDocDefault;
      var target = d.target_role || d.requested_role || d.apply_role || '';
      var status = d.status || d.review_status || 'pending';
      var date = d.created_at || d.updated_at || d.date || '';
      var attachments = Array.isArray(d.attachments || d.files) ? (d.attachments || d.files) : [];
      var uploadedAttachments = attachments.filter(function (file) { return String(file.upload_status || 'uploaded') === 'uploaded'; });
      var documentButton = uploadedAttachments.length
        ? '<button data-action="open-review-doc">'+esc(u.open)+' ('+esc(uploadedAttachments.length)+')</button>'
        : '<button data-action="open-review-doc">'+esc(u.detail)+'</button>';
      return '<div class="igdc-ma-review-row" data-review-id="'+esc(id)+'">'+
        '<div><b>'+esc(title)+'</b><br><span class="muted">'+esc(name || email || d.user_id || '')+'</span></div>'+ 
        '<div>'+esc(email || d.user_id || '')+'</div>'+ 
        '<div>'+esc(target || '-')+'</div>'+ 
        '<div><span class="badge">'+esc(status)+'</span><br><span class="muted">'+esc(date)+'</span></div>'+ 
        '<div class="igdc-ma-member-actions">'+
          documentButton+
          '<button data-action="approve-review-doc" class="primary" '+(status === 'pending' ? '' : 'disabled')+'>'+esc(u.approve)+'</button>'+
          '<button data-action="reject-review-doc" class="danger" '+(status === 'pending' ? '' : 'disabled')+'>'+esc(u.reject)+'</button>'+ 
        '</div>'+ 
      '</div>';
    }).join('');
    return '<div class="card igdc-ma-member-card"><div class="row" style="justify-content:space-between"><h4>'+esc(u.reviewTitle)+'</h4><button data-action="reload-review-queue">'+esc(u.reviewRefresh)+'</button></div>'+ 
      '<div class="muted" style="margin-bottom:8px">'+esc(u.reviewDesc)+'</div>'+ 
      (STATE.loadingReview ? '<div class="muted">'+esc(labels.loading)+'</div>' : '')+
      '<div class="igdc-ma-review-list">'+
        '<div class="igdc-ma-review-head"><div>'+esc(u.reviewHeadDoc)+'</div><div>'+esc(u.reviewHeadMember)+'</div><div>'+esc(u.reviewHeadTarget)+'</div><div>'+esc(u.reviewHeadStatus)+'</div><div>'+esc(u.reviewHeadReview)+'</div></div>'+ 
        (rows || '<div class="igdc-ma-review-row"><div class="muted" style="grid-column:1/-1">'+esc(u.noReviewDocs)+'</div></div>')+
      '</div>'+ 
      '<div class="muted" style="margin-top:8px">'+esc(u.shownItems)+' '+esc(docs.length)+' / '+esc(u.serverItems)+' '+esc((STATE.reviewDocs || []).length)+'</div></div>';
  }
  function adminNoticeHtml() {
    var u = uiText();
    var roles = (STATE.me && STATE.me.roles) || readRoles();
    var canPublish = canPublishNotices(roles);
    var questions = (STATE.adminQuestions || []).map(function (question) { return qnaQuestionCardHtml(question, u, true, true); }).join('');
    var noticeForm = canPublish
      ? '<form class="card" data-form="publish-notice"><h4>'+esc(u.noticePublishTitle)+'</h4><div class="muted">'+esc(u.noticePublishDesc)+'</div><br>'+
        '<label>'+esc(u.noticeTitleLabel)+'<input name="title" required placeholder="'+esc(u.noticeTitlePlaceholder)+'"></label><br><br>'+
        '<label>'+esc(u.noticeBodyLabel)+'<textarea name="body" required placeholder="'+esc(u.noticeBodyPlaceholder)+'"></textarea></label><br><br>'+
        '<button class="primary" type="submit">'+esc(u.publishButton)+'</button></form>'
      : '<div class="card"><h4>'+esc(u.noticePublishTitle)+'</h4><div class="muted">'+esc(u.noticePublishDenied)+'</div></div>';
    return noticeForm+
      '<section class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between"><h4>'+esc(u.adminQuestionsTitle)+'</h4><button data-action="reload-admin-questions">'+esc(u.adminQuestionsReload)+'</button></div><div class="muted">'+esc(u.adminQuestionsDesc)+'</div>'+
      (STATE.loadingAdminQuestions ? '<div class="muted" style="margin-top:8px">'+esc(t().loading)+'</div>' : '')+
      '<div class="igdc-ma-qna-list">'+(questions || '<div class="muted" style="margin-top:12px">'+esc(u.adminQuestionsNone)+'</div>')+'</div></section>';
  }
  function systemDiagnosticHtml(me) {
    var u = uiText();
    var allowed = canRunSystemDiagnostic((me && me.roles) || readRoles());
    if (!allowed) return '<div class="card"><h4>'+esc(u.diagnosticNotAllowed)+'</h4></div>';
    var report = STATE.diagnosticReport;
    var json = report ? JSON.stringify(report, null, 2) : u.diagnosticEmpty;
    var status = STATE.loadingDiagnostic ? u.diagnosticWaiting : (report && report.diagnosis && report.diagnosis.summary ? report.diagnosis.summary : u.diagnosticReadOnly);
    return '<div class="card igdc-ma-diagnostic-card"><h4>'+esc(u.diagnosticTitle)+'</h4>'+
      '<div class="muted">'+esc(u.diagnosticDesc)+'</div><div class="muted" style="margin-top:8px">'+esc(u.diagnosticReadOnly)+'</div><br>'+
      '<div class="row"><button class="primary" data-action="run-system-diagnostic" '+(STATE.loadingDiagnostic ? 'disabled' : '')+'>'+esc(u.diagnosticRun)+'</button>'+
      '<button data-action="download-system-diagnostic" '+(report ? '' : 'disabled')+'>'+esc(u.diagnosticDownload)+'</button></div>'+
      '<div class="muted" style="margin-top:10px">'+esc(status)+'</div>'+
      '<pre class="igdc-ma-diagnostic-json">'+esc(json)+'</pre></div>';
  }
  function handleClick(ev) {
    var closeBtn = ev.target.closest('[data-close]');
    if (closeBtn) { ev.preventDefault(); close(); return; }
    var tab = ev.target.closest('[data-tab]');
    if (tab) { ev.preventDefault(); setTab(tab.getAttribute('data-tab')); return; }
    var action = ev.target.closest('[data-action]');
    if (!action) return;
    ev.preventDefault();
    var act = action.getAttribute('data-action');
    if (act === 'login') openLogin(true);
    else if (act === 'open-page') openTarget();
    else if (act === 'reload-members') loadMembers();
    else if (act === 'prev-members') { if (STATE.page > 0) { STATE.page -= 1; loadMembers(); } }
    else if (act === 'next-members') { if (STATE.hasMore) { STATE.page += 1; loadMembers(); } }
    else if (act === 'search-members') { var s = document.getElementById('igdc-member-search'); STATE.query = s ? s.value : ''; STATE.page = 0; loadMembers(); }
    else if (act === 'save-role') saveRole(action.closest('[data-user-id]'));
    else if (act === 'clear-role-override') clearRoleOverride(action.closest('[data-user-id]'));
    else if (act === 'block-user') blockUser(action.closest('[data-user-id]'));
    else if (act === 'unblock-user') unblockUser(action.closest('[data-user-id]'));
    else if (act === 'request-upgrade') requestUpgrade(action.getAttribute('data-role'));
    else if (act === 'open-member-profile') setTab('member-profile');
    else if (act === 'reload-my-review') loadMyReviewDocs();
    else if (act === 'reload-review-queue') loadReviewDocs();
    else if (act === 'open-review-doc') openReviewDoc(action.closest('[data-review-id]'), action.getAttribute('data-url'));
    else if (act === 'approve-review-doc') reviewDoc(action.closest('[data-review-id]'), 'approve');
    else if (act === 'reject-review-doc') reviewDoc(action.closest('[data-review-id]'), 'reject');
    else if (act === 'reload-my-questions') loadMyQuestions();
    else if (act === 'reload-admin-questions') loadAdminQuestions();
    else if (act === 'reload-notices') loadNotices();
    else if (act === 'run-system-diagnostic') loadSystemDiagnostic(true);
    else if (act === 'download-system-diagnostic') downloadSystemDiagnostic();
  }
  function handleChange(ev) {
    if (ev.target && ev.target.id === 'igdc-member-search') STATE.query = ev.target.value;
  }
  function formDataObj(form) {
    var fd = new FormData(form), o = {};
    fd.forEach(function (v,k) { if (!(v instanceof File)) o[k] = v; });
    return o;
  }
  function attachmentFiles(form) {
    var input = form.querySelector('input[name="files"]');
    return input && input.files ? Array.prototype.slice.call(input.files) : [];
  }
  function uploadSignedAttachment(upload, file) {
    return fetch(upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    }).then(function (res) {
      if (!res.ok) throw new Error('첨부 파일 업로드에 실패했습니다: ' + (file.name || 'file'));
      return res;
    });
  }
  function submitDocument(form) {
    var body = formDataObj(form);
    var files = attachmentFiles(form);
    body.attachments = files.map(function (file) { return { name:file.name, size:file.size, type:file.type || 'application/octet-stream' }; });
    return apiPost('submit-document', body).then(function (data) {
      var uploads = data.uploads || [];
      if (!uploads.length) return data;
      if (uploads.length !== files.length) throw new Error('첨부 파일 전송 정보가 일치하지 않습니다.');
      return Promise.all(uploads.map(function (upload, index) { return uploadSignedAttachment(upload, files[index]); }))
        .then(function () { return apiPost('complete-document-upload', { id:(data.document && data.document.id), file_ids:uploads.map(function (upload) { return upload.file_id; }) }); });
    });
  }
  function handleSubmit(ev) {
    var form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    var type = form.getAttribute('data-form');
    if (type === 'member-profile') {
      saveMemberProfile(form);
      return;
    }
    if (type === 'document-submit') {
      submitDocument(form).then(function () {
        setError('');
        STATE.requestedRole = '';
        alert(uiText().documentSaved || uiText().registered);
        form.reset();
      }).catch(function (e) {
        var message = e && e.message ? e.message : String(e || '');
        if (/첨부 파일 업로드/.test(message)) message = (uiText().documentUploadFailed || message) + '\n' + message;
        setError(message);
      });
      return;
    }
    var body = formDataObj(form);
    var action = type === 'question-submit' ? 'submit-question' : (type === 'publish-notice' ? 'publish-notice' : 'admin-reply');
    apiPost(action, body).then(function () {
      setError('');
      alert(uiText().registered);
      form.reset();
      if (action === 'submit-question') loadMyQuestions();
      else if (action === 'publish-notice') loadNotices();
      else loadAdminQuestions();
    }).catch(function (e) { setError(e.message); });
  }
  function loadMyQuestions() {
    if (!hasValidToken()) { STATE.loadingQuestions = false; STATE.questions = []; render(); return; }
    STATE.loadingQuestions = true; STATE.error = ''; render();
    apiGet({action:'my-questions', page:0, per_page:cfg().questionPerPage || 50}).then(function (data) {
      STATE.questions = data.questions || data.items || [];
      STATE.loadingQuestions = false;
      render();
    }).catch(function (e) {
      STATE.loadingQuestions = false;
      STATE.questions = [];
      STATE.error = e.message || t().apiMissing;
      render();
    });
  }
  function loadAdminQuestions() {
    if (!canAdmin(readRoles()) && !(STATE.me && STATE.me.admin)) return;
    if (!hasValidToken()) { STATE.loadingAdminQuestions = false; STATE.adminQuestions = []; STATE.error = uiText().reviewTokenMissing; render(); return; }
    STATE.loadingAdminQuestions = true; STATE.error = ''; render();
    apiGet({action:'admin-questions', page:0, per_page:cfg().questionPerPage || 50}).then(function (data) {
      STATE.adminQuestions = data.questions || data.items || [];
      STATE.loadingAdminQuestions = false;
      render();
    }).catch(function (e) {
      STATE.loadingAdminQuestions = false;
      STATE.adminQuestions = [];
      STATE.error = e.message || t().apiMissing;
      render();
    });
  }
  function loadNotices() {
    if (!hasValidToken()) { STATE.loadingNotices = false; STATE.notices = []; render(); return; }
    STATE.loadingNotices = true; STATE.error = ''; render();
    apiGet({action:'notices', page:0, per_page:cfg().noticePerPage || 50}).then(function (data) {
      STATE.notices = data.notices || data.items || [];
      STATE.loadingNotices = false;
      render();
    }).catch(function (e) {
      STATE.loadingNotices = false;
      STATE.notices = [];
      STATE.error = e.message || t().apiMissing;
      render();
    });
  }
  function loadMyReviewDocs() {
    if (!hasValidToken()) {
      STATE.loadingMyReview = false;
      STATE.myReviewDocs = [];
      render();
      return;
    }
    STATE.loadingMyReview = true;
    apiGet({action:'my-review-documents', page:0, per_page:cfg().reviewPerPage || 100}).then(function (data) {
      STATE.myReviewDocs = data.documents || data.docs || data.items || [];
      STATE.loadingMyReview = false;
      render();
    }).catch(function (e) {
      STATE.loadingMyReview = false;
      STATE.myReviewDocs = [];
      STATE.error = e.message || uiText().reviewApiMissing;
      render();
    });
  }

  function loadReviewDocs() {
    if (!canAdmin(readRoles()) && !(STATE.me && STATE.me.admin)) return;
    if (!hasValidToken()) {
      STATE.loadingReview = false;
      STATE.reviewDocs = [];
      STATE.error = uiText().reviewTokenMissing;
      render();
      return;
    }
    STATE.loadingReview = true; STATE.error = ''; render();
    apiGet({action:'review-documents', page:0, per_page:cfg().reviewPerPage || 100}).then(function (data) {
      STATE.reviewDocs = data.documents || data.docs || data.items || data.queue || data.submissions || [];
      STATE.loadingReview = false;
      render();
    }).catch(function (e) {
      STATE.loadingReview = false;
      STATE.reviewDocs = [];
      STATE.error = e.message || uiText().reviewApiMissing;
      render();
    });
  }
  function findReviewDoc(row) {
    if (!row) return null;
    var id = row.getAttribute('data-review-id');
    return (STATE.reviewDocs || []).concat(STATE.myReviewDocs || []).filter(function (d) {
      return String(d.id || d.document_id || d.review_id || d.submission_id || '') === String(id || '');
    })[0] || null;
  }
  function openReviewDoc(row, url) {
    var doc = findReviewDoc(row) || {};
    var attachments = Array.isArray(doc.attachments || doc.files) ? (doc.attachments || doc.files) : [];
    var uploaded = attachments.filter(function (file) { return String(file.upload_status || 'uploaded') === 'uploaded'; });
    var fileUrl = url || doc.file_url || doc.url || doc.download_url || doc.attachment_url || '';
    if (fileUrl) { window.open(fileUrl, '_blank', 'noopener'); return; }
    if (!uploaded.length) {
      var u0 = uiText();
      alert((doc.title || u0.reviewDocDefault) + '\n\n' + (doc.body || doc.memo || doc.description || u0.noAttachment));
      return;
    }
    var selected = uploaded[0];
    if (uploaded.length > 1) {
      var promptText = uploaded.map(function (file, index) { return (index + 1) + '. ' + (file.original_name || file.name || 'file'); }).join('\n');
      var chosen = window.prompt((lang() === 'ko' ? '열람할 첨부 파일 번호를 입력하십시오.\n' : 'Enter the attachment number to open.\n') + promptText, '1');
      if (chosen === null) return;
      var index = Number.parseInt(chosen, 10) - 1;
      if (Number.isFinite(index) && uploaded[index]) selected = uploaded[index];
    }
    var viewer = window.open('about:blank', '_blank');
    try { if (viewer) viewer.opener = null; } catch (e) {}
    apiGet({action:'review-document-url', id:(doc.id || doc.document_id), file_id:selected.id}).then(function (data) {
      if (!data || !data.url) throw new Error(uiText().noAttachment);
      if (viewer) viewer.location.replace(data.url);
      else window.open(data.url, '_blank', 'noopener');
    }).catch(function (e) {
      try { if (viewer) viewer.close(); } catch (_) {}
      setError(e.message);
    });
  }
  function reviewDoc(row, decision) {
    var doc = findReviewDoc(row);
    if (!doc) return;
    var id = doc.id || doc.document_id || doc.review_id || doc.submission_id;
    if (!id) return;
    var u = uiText();
    if (!confirm((decision === 'approve' ? u.approve : u.reject) + ' ' + u.confirmProcess)) return;
    var note = window.prompt(u.reviewNotePrompt || 'Review note (optional):', '');
    if (note === null) return;
    apiPost('review-document', {id:id, decision:decision, review_note:note}).then(loadReviewDocs).catch(function (e) { setError(e.message); });
  }
  function diagnosticArtifact(data, requestError) {
    if (data && data.report) return data.report;
    if (data && typeof data === 'object') return data;
    return {
      report_type: 'igdc-member-review-supabase-diagnostic',
      checked_at: new Date().toISOString(),
      ok: false,
      diagnosis: { code: 'request_failed', summary: requestError || '시스템 점검 응답을 읽을 수 없습니다.' }
    };
  }
  function loadSystemDiagnostic(force) {
    var roles = (STATE.me && STATE.me.roles) || readRoles();
    if (!canRunSystemDiagnostic(roles)) { setError(uiText().diagnosticNotAllowed); return; }
    if (STATE.loadingDiagnostic) return;
    if (STATE.diagnosticReport && !force) { render(); return; }
    if (!hasValidToken()) { setError(uiText().reviewTokenMissing); return; }
    STATE.loadingDiagnostic = true;
    STATE.error = '';
    render();
    apiGet({action:'member-review-diagnostic'}).then(function (data) {
      STATE.diagnosticReport = diagnosticArtifact(data, '');
      STATE.loadingDiagnostic = false;
      render();
    }).catch(function (error) {
      STATE.diagnosticReport = diagnosticArtifact(null, error && error.message ? error.message : String(error || ''));
      STATE.loadingDiagnostic = false;
      render();
    });
  }
  function downloadSystemDiagnostic() {
    var roles = (STATE.me && STATE.me.roles) || readRoles();
    if (!canRunSystemDiagnostic(roles)) { setError(uiText().diagnosticNotAllowed); return; }
    var report = STATE.diagnosticReport;
    if (!report) return;
    var blob = new Blob([JSON.stringify(report, null, 2)], {type:'application/json;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'IGDC_Member_Review_Supabase_Diagnostic_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }
  function loadMemberProfile() {
    if (!hasValidToken()) {
      STATE.memberProfile = null;
      STATE.loadingMemberProfile = false;
      render();
      return Promise.resolve(null);
    }
    STATE.loadingMemberProfile = true;
    STATE.profileMessage = '';
    render();
    return apiGet({action:'member-profile'}).then(function (data) {
      STATE.memberProfile = (data && (data.profile || data.member_profile)) || {};
      if (STATE.me && data && data.profile_status) STATE.me.profile_status = data.profile_status;
      STATE.loadingMemberProfile = false;
      render();
      return data;
    }).catch(function (error) {
      STATE.loadingMemberProfile = false;
      STATE.memberProfile = {};
      STATE.error = (error && error.message) || t().apiMissing;
      render();
      return null;
    });
  }
  function saveMemberProfile(form) {
    if (STATE.savingProfile) return;
    var values = formDataObj(form);
    values.entry_locale = lang();
    STATE.savingProfile = true;
    STATE.profileMessage = '';
    STATE.error = '';
    render();
    apiPost('save-member-profile', {profile:values}).then(function (data) {
      STATE.memberProfile = (data && data.profile) || values;
      if (STATE.me && data && data.profile_status) STATE.me.profile_status = data.profile_status;
      var p = profileText();
      STATE.profileMessage = data && data.m2m_handoff && data.m2m_handoff.delivered ? p.eligible : p.pending;
      STATE.savingProfile = false;
      return loadMe();
    }).then(function () {
      render();
    }).catch(function (error) {
      STATE.savingProfile = false;
      STATE.error = (error && error.message) || t().apiMissing;
      render();
    });
  }
  function loadMe() {
    STATE.me = userProfile();
    return apiGet({action:'me'}).then(function (data) {
      if (data && data.me) STATE.me = Object.assign({}, STATE.me, data.me, {admin: data.me.admin != null ? data.me.admin : STATE.me.admin, management_scope: data.management_scope || data.me.management_scope || STATE.me.management_scope});
    }).catch(function () {});
  }
  function loadMembers() {
    if (!canAdmin(readRoles()) && !(STATE.me && STATE.me.admin)) return;
    if (!hasValidToken()) {
      STATE.loading = false;
      STATE.members = [];
      STATE.total = 0;
      STATE.hasMore = false;
      STATE.error = uiText().memberTokenMissing;
      render();
      return;
    }
    STATE.loading = true; STATE.error = ''; render();
    apiGet({action:'members', q:STATE.query || '', page:STATE.page || 0, per_page:cfg().perPage || 50}).then(function (data) {
      STATE.members = data.users || data.members || [];
      STATE.total = data.total || STATE.members.length;
      STATE.hasMore = !!data.has_more;
      STATE.loading = false;
      render();
    }).catch(function (e) {
      STATE.loading = false;
      STATE.hasMore = false;
      STATE.error = (e.message || t().apiMissing) + (!hasValidToken() ? uiText().tokenExpiredSuffix : '');
      render();
    });
  }
  function promptReason(message) {
    var reason = window.prompt(message || '');
    if (reason === null) return null;
    reason = String(reason || '').trim();
    if (!reason) {
      setError((lang() === 'ko') ? '처리 사유를 입력해야 합니다.' : 'A reason is required.');
      return null;
    }
    return reason;
  }
  function saveRole(row) {
    if (!row) return;
    var userId = row.getAttribute('data-user-id');
    var sel = row.querySelector('[data-role-select]');
    var role = normalizeRole(sel && sel.value);
    if (!userId || !role) {
      setError((lang() === 'ko') ? '적용할 특수 역할을 선택하십시오.' : 'Select a special role to apply.');
      return;
    }
    if (isAutoManagedRole(role)) {
      setError((lang() === 'ko') ? 'member, member_standard, member_premium은 OSO/M2M 자동 역할입니다.' : 'member, member_standard, and member_premium are OSO/M2M automatic roles.');
      return;
    }
    if (!canAssignRole((STATE.me && STATE.me.roles) || readRoles(), role)) { setError(uiText().changeNoPerm); return; }
    var reason = promptReason(uiText().roleReasonPrompt);
    if (reason === null) return;
    var u = uiText();
    if (!confirm(u.confirmRoleChangePrefix + role + u.confirmRoleChangeSuffix)) return;
    apiPost('update-role', {user_id:userId, role:role, reason:reason}).then(loadMembers).catch(function (e) { setError(e.message); });
  }
  function clearRoleOverride(row) {
    if (!row) return;
    var userId = row.getAttribute('data-user-id');
    if (!userId) return;
    var reason = promptReason(uiText().restoreReasonPrompt);
    if (reason === null) return;
    if (!confirm((lang() === 'ko') ? '관리자 예외 역할을 해제하고 OSO/M2M 기준으로 복귀하시겠습니까?' : 'Clear this admin exception and restore the OSO/M2M role?')) return;
    apiPost('clear-role-override', {user_id:userId, reason:reason}).then(loadMembers).catch(function (e) { setError(e.message); });
  }
  function blockUser(row) {
    if (!row) return;
    var userId = row.getAttribute('data-user-id');
    if (!userId) return;
    var member = memberForRow(row) || {};
    var reason = promptReason(uiText().blockReasonPrompt);
    if (reason === null) return;
    apiPost('prepare-block', {user_id:userId, reason:reason}).then(function (data) {
      if (!data) return null;
      var phrase = '';
      if (data.protected_account) {
        phrase = window.prompt((uiText().confirmProtectedBlockPrefix || '') + String(data.confirmation_phrase || ''));
        if (phrase === null) return null;
        if (String(phrase) !== String(data.confirmation_phrase || '')) {
          throw new Error((lang() === 'ko') ? '보호 계정 최종 확인 문구가 일치하지 않습니다.' : 'The protected-account confirmation phrase does not match.');
        }
      }
      var message = data.protected_account
        ? ((lang() === 'ko') ? '보호 계정의 차단을 최종 실행하시겠습니까?' : 'Apply the final block to this protected account?')
        : uiText().confirmBlock;
      if (!confirm(message)) return null;
      return apiPost('block-user', {
        user_id:userId,
        block_token:data.block_token,
        confirmation_phrase:phrase
      });
    }).then(function (result) {
      if (result) loadMembers();
    }).catch(function (e) { setError(e.message); });
  }
  function unblockUser(row) {
    if (!row) return;
    var userId = row.getAttribute('data-user-id');
    if (!userId) return;
    var reason = promptReason(uiText().unblockReasonPrompt);
    if (reason === null) return;
    if (!confirm((lang() === 'ko') ? '이 회원의 차단을 해제하시겠습니까?' : 'Unblock this member?')) return;
    apiPost('unblock-user', {user_id:userId, reason:reason}).then(loadMembers).catch(function (e) { setError(e.message); });
  }
  function requestUpgrade(role) {
    STATE.requestedRole = normalizeRole(role || '');
    setTab('submit');
  }
  function open(preferredTab) {
    if (!hasValidToken()) { openLogin(true); return; }
    STATE.lastFocus = document.activeElement;
    STATE.opened = true;
    STATE.tab = preferredTab || 'member-home';
    var el = root();
    el.hidden = false;
    loadMe().then(function () { render(); if (STATE.tab === 'member-page') loadMyReviewDocs(); if (STATE.tab === 'admin-members') loadMembers(); if (STATE.tab === 'admin-queue') loadReviewDocs(); if (STATE.tab === 'admin-diagnostic') loadSystemDiagnostic(); });
    render();
    try { el.querySelector('button').focus(); } catch (e) {}
  }
  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.hidden = true;
    STATE.opened = false;
    try { if (STATE.lastFocus && STATE.lastFocus.focus) STATE.lastFocus.focus(); } catch (e) {}
  }
  function bindTrigger() {
    if (bindTrigger.done) return;
    bindTrigger.done = true;
    document.addEventListener('click', function (ev) {
      var target = ev.target && ev.target.closest && ev.target.closest('#mo-btn,[data-member-modal="open"],.js-member-admin-modal-trigger,.js-seller-modal-trigger');
      if (!target) return;
      ev.preventDefault();
      ev.stopPropagation();
      open('member-home');
    }, true);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
  }

  window.IGDCMemberAdminModal = { __version: VERSION, open: open, close: close, loadMembers: loadMembers, targetPage: targetPage, isLoggedIn: isLoggedIn };
  window.openMemberAdminModal = open;
  window.closeMemberAdminModal = close;
  if (typeof window.openModal !== 'function') window.openModal = function () { open('member-home'); };
  if (typeof window.injectModal !== 'function') window.injectModal = function () { open('member-home'); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTrigger, {once:true});
  else bindTrigger();
})();
