/*
 * IGDC Social Network main-card viewer bridge v3.1.0-social-oauth
 * Scope: social main 9 sections ONLY.
 * Non-goals: right panel, distribution, snapshot storage, candidate/admin, automap ownership.
 *
 * UX contract
 * 1) Main SNS card click -> IGDC in-page full-viewport player (browser chrome remains).
 * 2) Fullscreen button -> native browser fullscreen for the media stage.
 * 3) ESC from native fullscreen -> returns to the in-page full-viewport player.
 * 4) ESC again / top-left list button / browser Back -> returns to the 9-section list.
 * 5) Initial card click never navigates to youtube.com / instagram.com / etc.
 */
(function () {
  'use strict';

  if (window.__IGDC_SOCIAL_SNS_VIEWER_V2__) return;
  window.__IGDC_SOCIAL_SNS_VIEWER_V2__ = true;

  /* Disable the legacy inline social-main fullscreen handler in socialnetwork.html. */
  window.__SOCIAL_MAIN_FULLSCREEN_READY__ = true;

  var MAIN_KEYS = {
    'social-youtube': 'youtube',
    'social-instagram': 'instagram',
    'social-tiktok': 'tiktok',
    'social-facebook': 'facebook',
    'social-wechat': 'wechat',
    'social-weibo': 'weibo',
    'social-pinterest': 'pinterest',
    'social-reddit': 'reddit',
    'social-twitter': 'twitter'
  };

  var state = {
    open: false,
    pushed: false,
    previousFocus: null,
    closingFromHistory: false,
    lastUrl: '',
    lastPreview: '',
    platform: '',
    parentTopState: null,
    youtubeDetailToken: 0,
    youtubeOAuthStatus: 'unknown',
    youtubeOAuthPopup: null,
    youtubePendingAction: null
  };

  function text(v) { return v == null ? '' : String(v); }
  function q(sel, root) { return (root || document).querySelector(sel); }

  function decodeEntities(value) {
    var raw = text(value);
    if (!raw || raw.indexOf('&') < 0) return raw;
    var box = document.createElement('textarea');
    var current = raw;
    /* Search providers sometimes double-encode numeric entities. Decode a
       bounded number of rounds so `&amp;#xacbd;` also becomes the real text. */
    for (var i = 0; i < 3 && current.indexOf('&') >= 0; i++) {
      box.innerHTML = current;
      var next = text(box.value).trim();
      if (!next || next === current) break;
      current = next;
    }
    return current;
  }

  function language() {
    var raw = text(document.documentElement.lang || navigator.language || 'en')
      .toLowerCase().replace(/_/g, '-');
    if (raw === 'ko-kr') return 'ko';
    if (raw === 'zh-cn' || raw === 'zh-hans') return 'zh';
    if (raw === 'zh-tw' || raw === 'zh-hk' || raw === 'zh-hant') return 'zht';
    if (raw === 'fil') return 'tl';
    return raw.split('-')[0] || 'en';
  }

  var LABELS = {
    ko: { list:'목록으로', fullscreen:'전체 화면', exitFullscreen:'전체 화면 종료', loading:'콘텐츠를 불러오는 중입니다.', unavailable:'이 콘텐츠는 현재 내부 재생을 준비할 수 없습니다.', ytChecking:'YouTube 상세 정보를 확인하는 중입니다.', ytDetailUnavailable:'YouTube 공개 상세 정보를 불러오지 못해 현재 저장된 제목·설명만 표시합니다.', ytSubscriber:'구독자', ytViews:'조회수', ytLikes:'좋아요', ytComments:'댓글', ytOpenComments:'댓글 더보기', ytCloseComments:'댓글 접기', ytSort:'정렬 기준', ytSortTop:'인기순', ytSortNewest:'최신순', ytMore:'더보기', ytLess:'간략히', ytShare:'공유', ytSave:'저장', ytSaved:'저장됨', ytSubscribe:'구독', ytJoin:'가입', ytCommentAdd:'댓글 추가…', ytOAuth:'구독·좋아요·댓글 작성은 YouTube 계정 연결이 필요합니다.', ytConnect:'YouTube 계정 연결', ytConnecting:'계정 연결 중…', ytConnected:'계정 연결됨', ytCommentPost:'댓글', ytSubscribed:'구독됨', ytLiked:'좋아요 완료', ytActionFailed:'요청을 처리하지 못했습니다.', ytPublicNote:'조회수·좋아요·댓글은 YouTube 공개 데이터입니다.' },
    en: { list:'Back to list', fullscreen:'Fullscreen', exitFullscreen:'Exit fullscreen', loading:'Loading content…', unavailable:'This content cannot currently be prepared for in-site playback.', ytChecking:'Loading YouTube details…', ytDetailUnavailable:'YouTube public details are unavailable; showing the stored title and description.', ytSubscriber:'Subscribers', ytViews:'Views', ytLikes:'Like', ytComments:'Comments', ytOpenComments:'Show more comments', ytCloseComments:'Show fewer comments', ytSort:'Sort by', ytSortTop:'Top comments', ytSortNewest:'Newest first', ytMore:'Show more', ytLess:'Show less', ytShare:'Share', ytSave:'Save', ytSaved:'Saved', ytSubscribe:'Subscribe', ytJoin:'Join', ytCommentAdd:'Add a comment…', ytOAuth:'Subscribe, like and comment posting require a YouTube account connection.', ytConnect:'Connect YouTube', ytConnecting:'Connecting…', ytConnected:'Connected', ytCommentPost:'Post', ytSubscribed:'Subscribed', ytLiked:'Liked', ytActionFailed:'Could not complete this action.', ytPublicNote:'Views, likes and comments are public YouTube data.' },
    ja: { list:'一覧へ', fullscreen:'全画面', exitFullscreen:'全画面を終了', loading:'コンテンツを読み込み中です。', unavailable:'このコンテンツは現在サイト内再生を準備できません。', ytChecking:'YouTubeの詳細を読み込み中です。', ytDetailUnavailable:'YouTubeの公開詳細を取得できないため、保存済みのタイトルと説明を表示します。', ytSubscriber:'登録者', ytViews:'視聴回数', ytLikes:'高評価', ytComments:'コメント', ytOpenComments:'コメントをもっと見る', ytCloseComments:'コメントを閉じる', ytSort:'並べ替え', ytSortTop:'人気順', ytSortNewest:'新しい順', ytMore:'もっと見る', ytLess:'一部を表示', ytShare:'共有', ytSave:'保存', ytSaved:'保存済み', ytSubscribe:'登録', ytJoin:'メンバーになる', ytCommentAdd:'コメントを追加…', ytOAuth:'登録・高評価・コメント投稿には YouTube アカウント接続が必要です。', ytConnect:'YouTubeを接続', ytConnecting:'接続中…', ytConnected:'接続済み', ytCommentPost:'投稿', ytSubscribed:'登録済み', ytLiked:'高評価済み', ytActionFailed:'操作を完了できませんでした。', ytPublicNote:'視聴回数・高評価・コメントは YouTube の公開データです。' },
    zh: { list:'返回列表', fullscreen:'全屏', exitFullscreen:'退出全屏', loading:'正在加载内容。', unavailable:'此内容目前无法在站内准备播放。', ytChecking:'正在加载 YouTube 详细信息。', ytDetailUnavailable:'无法获取 YouTube 公开详细信息，显示已保存的标题和说明。', ytSubscriber:'订阅者', ytViews:'观看次数', ytLikes:'点赞', ytComments:'评论', ytOpenComments:'查看更多评论', ytCloseComments:'收起评论', ytSort:'排序', ytSortTop:'热门', ytSortNewest:'最新', ytMore:'展开', ytLess:'收起', ytShare:'分享', ytSave:'保存', ytSaved:'已保存', ytSubscribe:'订阅', ytJoin:'加入', ytCommentAdd:'添加评论…', ytOAuth:'订阅、点赞和发表评论需要连接 YouTube 帐号。', ytConnect:'连接 YouTube', ytConnecting:'正在连接…', ytConnected:'已连接', ytCommentPost:'发布', ytSubscribed:'已订阅', ytLiked:'已点赞', ytActionFailed:'无法完成此操作。', ytPublicNote:'观看次数、点赞和评论来自 YouTube 公开数据。' },
    zht:{ list:'返回列表', fullscreen:'全螢幕', exitFullscreen:'退出全螢幕', loading:'正在載入內容。', unavailable:'此內容目前無法在站內準備播放。', ytChecking:'正在載入 YouTube 詳細資訊。', ytDetailUnavailable:'無法取得 YouTube 公開詳細資訊，顯示已儲存的標題與說明。', ytSubscriber:'訂閱者', ytViews:'觀看次數', ytLikes:'喜歡', ytComments:'留言', ytOpenComments:'查看更多留言', ytCloseComments:'收起留言', ytSort:'排序', ytSortTop:'熱門', ytSortNewest:'最新', ytMore:'展開', ytLess:'收起', ytShare:'分享', ytSave:'儲存', ytSaved:'已儲存', ytSubscribe:'訂閱', ytJoin:'加入', ytCommentAdd:'新增留言…', ytOAuth:'訂閱、喜歡與留言發佈需要連接 YouTube 帳號。', ytConnect:'連接 YouTube', ytConnecting:'正在連接…', ytConnected:'已連接', ytCommentPost:'發佈', ytSubscribed:'已訂閱', ytLiked:'已喜歡', ytActionFailed:'無法完成此操作。', ytPublicNote:'觀看次數、喜歡和留言來自 YouTube 公開資料。' }
  };
  function labels() { return LABELS[language()] || LABELS.en; }

  function validHttp(url) {
    return /^https?:\/\//i.test(text(url).trim());
  }

  function placeholderUrl(url) {
    url = text(url).trim();
    return !url || url === '#' || /^javascript:/i.test(url) ||
      /\/pages\/coming-soon\.html/i.test(url) ||
      /(?:^|\.)example\.com(?:[\/:?#]|$)/i.test(url) ||
      /social[_-](?:youtube|instagram|tiktok|facebook|wechat|weibo|pinterest|reddit|twitter)[_-]?\d+/i.test(url) ||
      /tiktok\.com\/@seed\/video\//i.test(url) ||
      /reddit\.com\/r\/seed\/comments\//i.test(url);
  }

  function placeholderCard(card) {
    if (!card) return true;
    var title = decodeEntities(titleOf(card));
    if (/\bSAMPLE\s*\d+\b/i.test(title) || /^Loading(?:…|\.\.\.)?$/i.test(title)) return true;
    return false;
  }

  function sectionPlatform(card) {
    var grid = card && card.closest && card.closest('.thumb-grid[data-psom-key]');
    var key = grid ? text(grid.getAttribute('data-psom-key')).trim() : '';
    return MAIN_KEYS[key] || '';
  }

  function isMainSocialCard(card) {
    var grid = card && card.closest && card.closest('.thumb-grid[data-psom-key]');
    if (!grid) return false;
    var key = text(grid.getAttribute('data-psom-key')).trim();
    return Object.prototype.hasOwnProperty.call(MAIN_KEYS, key);
  }

  function getBgUrl(el) {
    if (!el) return '';
    var bg = text(getComputedStyle(el).backgroundImage);
    var m = bg.match(/url\(["']?(.*?)["']?\)/i);
    return m && m[1] ? m[1] : '';
  }

  function firstUrl(card) {
    if (!card || placeholderCard(card)) return '';
    var d = card.dataset || {};
    var values = [
      d.socialUrl,
      d.latestContentUrl,
      d.contentUrl,
      d.canonicalUrl,
      d.permalink,
      d.embedUrl,
      d.href,
      d.url,
      card.getAttribute('data-social-url'),
      card.getAttribute('data-latest-content-url'),
      card.getAttribute('data-content-url'),
      card.getAttribute('data-canonical-url'),
      card.getAttribute('data-permalink'),
      card.getAttribute('href')
    ];
    for (var i = 0; i < values.length; i++) {
      var value = text(values[i]).trim();
      if (validHttp(value) && !placeholderUrl(value)) return value;
    }
    return '';
  }

  function titleOf(card) {
    var el = q('.title', card);
    return decodeEntities(text(el && el.textContent).trim());
  }

  function descOf(card) {
    var el = q('.desc', card);
    return decodeEntities(text(el && el.textContent).trim());
  }

  function videoIdYouTube(url) {
    try {
      var u = new URL(url, location.href);
      var h = u.hostname.replace(/^www\./, '').toLowerCase();
      if (h === 'youtu.be') return (u.pathname.split('/')[1] || '').trim();
      if (/youtube(?:-nocookie)?\.com$/.test(h)) {
        if (u.pathname === '/watch') return text(u.searchParams.get('v')).trim();
        var m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i);
        if (m) return m[1];
      }
    } catch (_) {}
    return '';
  }

  function videoIdYouTubeFromThumb(card) {
    var d = card && card.dataset || {};
    var pic = q('.pic', card);
    var img = q('img', card);
    var candidates = [d.thumbnailUrl, d.thumb, d.image, img && img.src, getBgUrl(pic)];
    for (var i = 0; i < candidates.length; i++) {
      var src = text(candidates[i]);
      var m = src.match(/(?:i\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([^/]+)/i);
      if (m) return m[1];
    }
    return '';
  }

  function statusId(url) {
    var m = text(url).match(/\/status(?:es)?\/(\d+)/i);
    return m ? m[1] : '';
  }

  function tiktokVideoId(url) {
    var raw = text(url);
    var m = raw.match(/\/video\/(\d+)/i) || raw.match(/\/v\/(\d+)\.html(?:[?#]|$)/i);
    if (m) return m[1];
    try {
      var u = new URL(raw, location.href);
      return text(u.searchParams.get('item_id') || u.searchParams.get('video_id')).replace(/\D/g, '');
    } catch (_) { return ''; }
  }

  function pinterestPinId(url) {
    var m = text(url).match(/\/pin\/(\d+)/i);
    return m ? m[1] : '';
  }

  function normalizeRedditPath(url) {
    try {
      var u = new URL(url, location.href);
      return u.pathname + (u.search || '');
    } catch (_) { return ''; }
  }

  function instagramEmbed(url) {
    try {
      var u = new URL(url, location.href);
      var m = u.pathname.match(/^\/(p|reel|reels|tv)\/([^/?#]+)/i);
      if (!m) return '';
      var kind = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase();
      return 'https://www.instagram.com/' + kind + '/' + m[2] + '/embed/';
    } catch (_) { return ''; }
  }

  function facebookIsVideo(url) {
    return /\/(?:reel|watch|videos?)\//i.test(url) || /[?&]v=\d+/i.test(url) || /fb\.watch/i.test(url);
  }

  function facebookEmbed(url) {
    if (!validHttp(url)) return '';
    var encoded = encodeURIComponent(url);
    if (facebookIsVideo(url)) {
      return 'https://www.facebook.com/plugins/video.php?href=' + encoded + '&show_text=false&autoplay=true&width=1280';
    }
    /* Facebook post plugin has a provider-side natural width limit.
       Keep its native 750px document, then scale the whole frame inside IGDC. */
    return 'https://www.facebook.com/plugins/post.php?href=' + encoded + '&show_text=false&width=750';
  }

  function buildEmbed(platform, url, card) {
    platform = text(platform).toLowerCase();
    url = text(url).trim();

    if (platform === 'youtube') {
      var yid = videoIdYouTube(url) || videoIdYouTubeFromThumb(card);
      if (!yid) return null;
      return {
        mode: 'iframe',
        src: 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(yid) + '?autoplay=1&playsinline=1&rel=0&enablejsapi=1',
        aspect: '16/9'
      };
    }

    if (platform === 'instagram') {
      var ig = instagramEmbed(url);
      if (!ig) return null;
      return { mode: 'iframe', src: ig, aspect: '9/16' };
    }

    if (platform === 'tiktok') {
      var tid = tiktokVideoId(url);
      if (!tid) return null;
      return {
        mode: 'iframe',
        src: 'https://www.tiktok.com/player/v1/' + encodeURIComponent(tid) + '?autoplay=1&loop=0&controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1',
        aspect: '9/16'
      };
    }

    if (platform === 'facebook') {
      var fb = facebookEmbed(url);
      if (!fb) return null;
      return {
        mode: 'iframe',
        src: fb,
        aspect: facebookIsVideo(url) ? '16/9' : 'auto',
        provider: facebookIsVideo(url) ? 'facebook-video' : 'facebook-post'
      };
    }

    if (platform === 'twitter') {
      var xid = statusId(url);
      if (!xid) return null;
      return {
        mode: 'iframe',
        src: 'https://platform.twitter.com/embed/Tweet.html?dnt=true&id=' + encodeURIComponent(xid),
        aspect: 'auto'
      };
    }

    if (platform === 'pinterest') {
      var pid = pinterestPinId(url);
      if (!pid) return null;
      return {
        mode: 'iframe',
        src: 'https://assets.pinterest.com/ext/embed.html?id=' + encodeURIComponent(pid),
        aspect: 'auto'
      };
    }

    if (platform === 'reddit') {
      var path = normalizeRedditPath(url);
      if (!path || path.indexOf('/comments/') < 0) return null;
      return {
        mode: 'iframe',
        src: 'https://www.redditmedia.com' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'ref_source=embed&ref=share&embed=true',
        aspect: 'auto'
      };
    }

    /* WeChat / Weibo do not expose a stable public player endpoint.
       Keep them inside IGDC and attempt the original public page in a contained frame.
       No top-navigation/popups are granted to the frame. */
    if ((platform === 'wechat' || platform === 'weibo') && validHttp(url)) {
      return { mode: 'iframe', src: url, aspect: 'auto', restrictedProvider: true };
    }

    return null;
  }

  function injectStyle() {
    if (document.getElementById('igdcSocialViewerV2Style')) return;
    var s = document.createElement('style');
    s.id = 'igdcSocialViewerV2Style';
    var mainScopes = Object.keys(MAIN_KEYS).map(function (key) {
      return '.thumb-grid[data-psom-key="' + key + '"]';
    });
    var mainPic = mainScopes.map(function (scope) { return scope + ' a.card .pic'; }).join(',');
    var mainPicMedia = mainScopes.map(function (scope) { return scope + ' a.card .pic img,' + scope + ' a.card .pic video'; }).join(',');
    var mainMeta = mainScopes.map(function (scope) { return scope + ' a.card .meta'; }).join(',');
    var mainTitle = mainScopes.map(function (scope) { return scope + ' a.card .title'; }).join(',');
    s.textContent = '' +
      mainPic + '{width:100%!important;height:auto!important;aspect-ratio:16/9!important;min-height:0!important;overflow:hidden!important;background-position:center!important;background-size:cover!important;background-repeat:no-repeat!important}' +
      mainPicMedia + '{width:100%!important;height:100%!important;object-fit:cover!important;object-position:center!important}' +
      mainMeta + '{display:flex!important;flex-direction:column!important;min-height:92px!important;box-sizing:border-box!important}' +
      mainTitle + '{display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:3!important;overflow:hidden!important;white-space:normal!important;text-overflow:ellipsis!important;line-height:1.35!important;max-height:4.05em!important;word-break:break-word!important}' +
      '#igdcSocialViewerV2{position:fixed;inset:0;z-index:2147483640;display:none;background:#000;color:#fff;overscroll-behavior:none}' +
      '#igdcSocialViewerV2.open{display:flex;flex-direction:column}' +
      '#igdcSocialViewerV2 .igsv-toolbar{height:56px;flex:0 0 56px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#090a0c;border-bottom:1px solid rgba(255,255,255,.14);box-sizing:border-box}' +
      '#igdcSocialViewerV2 .igsv-back,#igdcSocialViewerV2 .igsv-full{border:0;border-radius:9px;min-height:40px;padding:0 13px;background:#17191d;color:#fff;font:600 14px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;white-space:nowrap}' +
      '#igdcSocialViewerV2 .igsv-back{display:inline-flex;align-items:center;gap:7px}' +
      '#igdcSocialViewerV2 .igsv-title{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 14px/1.3 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-stage{position:relative;min-height:0;flex:1 1 auto;display:flex;align-items:stretch;justify-content:stretch;background:#000;overflow:hidden;overscroll-behavior:none}' +
      '#igdcSocialViewerV2 .igsv-scroll{position:relative;width:100%;height:100%;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:#000}' +
      '#igdcSocialViewerV2 .igsv-content{width:100%;min-height:100%;box-sizing:border-box;padding:0;background:#000;display:flex;flex-direction:column;align-items:center}' +
      '#igdcSocialViewerV2 .igsv-media{position:relative;width:100%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden}' +
      '#igdcSocialViewerV2 .igsv-media[data-aspect="16/9"]{aspect-ratio:16/9}' +
      '#igdcSocialViewerV2 .igsv-media[data-aspect="9/16"]{width:min(100%,720px);aspect-ratio:9/16}' +
      '#igdcSocialViewerV2 .igsv-media[data-aspect="auto"]{height:max(720px,calc(100dvh - 56px - 56px));min-height:720px}' +
      '#igdcSocialViewerV2 .igsv-frame{width:100%;height:100%;border:0;background:#000;display:block;flex:0 0 auto}' +
      '#igdcSocialViewerV2 .igsv-detail{width:100%;max-width:none;box-sizing:border-box;padding:22px clamp(18px,3vw,48px) 28px;background:#fff;color:#111;border-top:1px solid #e5e7eb;align-self:stretch}' +
      '#igdcSocialViewerV2 .igsv-detail-title{font:700 20px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;word-break:break-word}' +
      '#igdcSocialViewerV2 .igsv-detail-desc{margin-top:10px;color:#333;font:400 15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;white-space:pre-wrap;word-break:break-word}' +
      '#igdcSocialViewerV2 .igsv-safe-space{width:100%;height:90px;min-height:90px;flex:0 0 90px;background:#fff}' +
      '#igdcSocialViewerV2 .igsv-yt-live{margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb}' +
      '#igdcSocialViewerV2 .igsv-yt-channel{display:flex;align-items:center;gap:10px;min-height:44px}' +
      '#igdcSocialViewerV2 .igsv-yt-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;background:#eef0f2;flex:0 0 40px}' +
      '#igdcSocialViewerV2 .igsv-yt-channel-copy{min-width:0;flex:1 1 auto}' +
      '#igdcSocialViewerV2 .igsv-yt-channel-name{font:700 15px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#igdcSocialViewerV2 .igsv-yt-subs{margin-top:2px;color:#666;font:400 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}' +
      '#igdcSocialViewerV2 .igsv-yt-pill{display:inline-flex;align-items:center;min-height:34px;padding:0 12px;border-radius:18px;background:#f1f3f5;color:#111;font:600 13px/1 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-comments{margin-top:14px;border-top:1px solid #e5e7eb;padding-top:12px}' +
      '#igdcSocialViewerV2 .igsv-yt-comments>summary{cursor:pointer;list-style:none;font:700 14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;user-select:none}' +
      '#igdcSocialViewerV2 .igsv-yt-comments>summary::-webkit-details-marker{display:none}' +
      '#igdcSocialViewerV2 .igsv-yt-comment{display:flex;gap:10px;padding:14px 0;border-bottom:1px solid #eceff1}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-avatar{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#eef0f2;flex:0 0 34px}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-body{min-width:0;flex:1 1 auto}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-head{color:#555;font:600 12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-text{margin-top:4px;white-space:pre-wrap;word-break:break-word;color:#111;font:400 14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-like{margin-top:5px;color:#666;font:400 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-note{margin-top:10px;color:#666;font:400 12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-stage[data-provider="facebook-post"]{align-items:stretch;justify-content:stretch;overflow:hidden;background:#fff}' +
      '#igdcSocialViewerV2 .igsv-stage[data-provider="facebook-post"] .igsv-fb-shell{position:relative;width:100%;height:100%;overflow:auto;background:#fff;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' +
      '#igdcSocialViewerV2 .igsv-stage[data-provider="facebook-post"] .igsv-fb-canvas{position:relative;margin:0 auto;transform-origin:top left;background:#fff}' +
      '#igdcSocialViewerV2 .igsv-stage[data-provider="facebook-post"] .igsv-frame{position:absolute;left:0;top:0;z-index:2;max-width:none;transform:none!important;background:#fff;pointer-events:auto;touch-action:auto}' +
      '#igdcSocialViewerV2 .igsv-fb-owned-media{width:100%;background:#111;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
      '#igdcSocialViewerV2 .igsv-fb-owned-media img{display:block;width:100%;height:auto;max-width:100%;object-fit:contain;object-position:center;background:#111}' +
      '#igdcSocialViewerV2 .igsv-fb-official{width:100%;box-sizing:border-box;padding:12px clamp(18px,3vw,48px) 0;background:#fff;color:#111;border-top:1px solid #e5e7eb}' +
      '#igdcSocialViewerV2 .igsv-fb-like-frame{display:block;width:100%;height:76px;border:0;background:#fff}' +
      '#igdcSocialViewerV2 .igsv-fb-comments-head{display:flex;align-items:center;gap:10px;min-height:44px;border-top:1px solid #e5e7eb;padding-top:8px}' +
      '#igdcSocialViewerV2 .igsv-fb-comments-toggle{border:0;border-radius:18px;background:#f1f3f5;color:#111;min-height:34px;padding:0 14px;font:700 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer}' +
      '#igdcSocialViewerV2 .igsv-fb-save{margin-left:auto}' +
      '#igdcSocialViewerV2 .igsv-fb-comments-wrap{width:100%;overflow:hidden;background:#fff}' +
      '#igdcSocialViewerV2 .igsv-fb-comments-frame{display:block;width:100%;height:min(62vh,640px);min-height:360px;border:0;background:#fff}' +
      '#igdcSocialViewerV2 .igsv-status{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:500 15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#ddd;background:#000}' +
      '#igdcSocialViewerV2 .igsv-status[hidden]{display:none}' +
      '#igdcSocialViewerV2 .igsv-stage:fullscreen{width:100vw;height:100vh;background:#000}' +
      '#igdcSocialViewerV2 .igsv-stage:fullscreen .igsv-scroll{width:100%;height:100%}' +
      '#igdcSocialViewerV2 .igsv-detail{padding:22px clamp(20px,4vw,64px) 26px}' +
      '#igdcSocialViewerV2 .igsv-detail-title{font-size:22px;line-height:1.4;font-weight:700}' +
      '#igdcSocialViewerV2 .igsv-detail-desc-wrap{position:relative;margin-top:12px;padding:12px 14px 10px;border-radius:12px;background:#f2f2f2;color:#222}' +
      '#igdcSocialViewerV2 .igsv-detail-desc{margin-top:0;color:#222;font-size:15px;line-height:1.6}' +
      '#igdcSocialViewerV2 .igsv-detail-desc.is-collapsed{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;overflow:hidden;white-space:pre-wrap}' +
      '#igdcSocialViewerV2 .igsv-detail-toggle{display:block;margin:6px 0 0 auto;border:0;background:transparent;color:#111;font:700 14px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;padding:3px 0}' +
      '#igdcSocialViewerV2 .igsv-yt-live{margin-top:18px;padding-top:0;border-top:0}' +
      '#igdcSocialViewerV2 .igsv-yt-channel{padding:14px 0;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb}' +
      '#igdcSocialViewerV2 .igsv-yt-channel-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex:0 0 auto}' +
      '#igdcSocialViewerV2 .igsv-yt-action{border:0;border-radius:20px;min-height:38px;padding:0 16px;background:#f1f1f1;color:#111;font:700 14px/1 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;white-space:nowrap}' +
      '#igdcSocialViewerV2 .igsv-yt-action.is-primary{background:#0f0f0f;color:#fff}' +
      '#igdcSocialViewerV2 .igsv-yt-action[aria-disabled=true]{opacity:.72}' +
      '#igdcSocialViewerV2 .igsv-yt-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 0}' +
      '#igdcSocialViewerV2 .igsv-provider-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:14px;padding:14px 0 2px;border-top:1px solid #e5e7eb}' +
      '#igdcSocialViewerV2 .igsv-yt-views{margin-right:auto;color:#444;font:600 14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-oauth-hint{display:none;margin:6px 0 0;color:#666;font:500 12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-oauth-hint.show{display:block}' +
      '#igdcSocialViewerV2 .igsv-yt-comments{margin-top:18px;border-top:1px solid #e5e7eb;padding-top:16px}' +
      '#igdcSocialViewerV2 .igsv-yt-comments-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:10px}' +
      '#igdcSocialViewerV2 .igsv-yt-comments-title{margin:0;font:700 20px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;color:#111}' +
      '#igdcSocialViewerV2 .igsv-yt-sort{display:flex;align-items:center;gap:7px;color:#333;font:600 14px/1.3 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-sort select{border:1px solid #d6d6d6;border-radius:8px;background:#fff;color:#111;padding:6px 28px 6px 9px;font:600 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-compose{display:flex;align-items:flex-end;gap:10px;padding:10px 0 14px;border-bottom:1px solid #e5e7eb;color:#777;font:400 14px/1.3 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-compose-dot{width:34px;height:34px;border-radius:50%;background:#e2e4e7;flex:0 0 34px}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-input{min-width:0;flex:1 1 auto;resize:vertical;min-height:38px;max-height:160px;border:0;border-bottom:1px solid #b8b8b8;background:#fff;color:#111;padding:8px 2px;font:400 14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;outline:none}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-submit{border:0;border-radius:18px;min-height:36px;padding:0 14px;background:#111;color:#fff;font:700 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-submit:disabled{opacity:.45;cursor:default}' +
      '#igdcSocialViewerV2 .igsv-yt-auth-state{margin:4px 0 0;color:#666;font:600 12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#igdcSocialViewerV2 .igsv-yt-comment.is-hidden{display:none}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-text.expanded{display:block;overflow:visible}' +
      '#igdcSocialViewerV2 .igsv-yt-comment-more,#igdcSocialViewerV2 .igsv-yt-comments-toggle{border:0;background:transparent;color:#111;font:700 13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;padding:6px 0}' +
      '#igdcSocialViewerV2 .igsv-yt-comments-toggle{margin:0 0 0 2px;font-size:14px;white-space:nowrap}' +
      '#igdcSocialViewerV2 .igsv-yt-note{margin-top:8px}' +
      '@media(max-width:768px){#igdcSocialViewerV2 .igsv-toolbar{height:52px;flex-basis:52px;padding:0 8px;gap:7px}#igdcSocialViewerV2 .igsv-back,#igdcSocialViewerV2 .igsv-full{min-height:38px;padding:0 10px;font-size:13px}#igdcSocialViewerV2 .igsv-media[data-aspect="auto"]{height:max(640px,calc(100dvh - 52px - 56px));min-height:640px}#igdcSocialViewerV2 .igsv-detail{padding:16px}#igdcSocialViewerV2 .igsv-detail-title{font-size:18px}}';
    (document.head || document.documentElement).appendChild(s);
  }

  function ensureViewer() {
    var root = document.getElementById('igdcSocialViewerV2');
    if (root) return root;
    injectStyle();
    var l = labels();
    root = document.createElement('div');
    root.id = 'igdcSocialViewerV2';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '' +
      '<div class="igsv-toolbar">' +
        '<button type="button" class="igsv-back" aria-label="' + l.list + '"><span aria-hidden="true">←</span><span class="igsv-back-label">' + l.list + '</span></button>' +
        '<div class="igsv-title"></div>' +
        '<button type="button" class="igsv-full" aria-label="' + l.fullscreen + '">⛶ <span class="igsv-full-label">' + l.fullscreen + '</span></button>' +
      '</div>' +
      '<div class="igsv-stage" data-aspect="auto">' +
        '<div class="igsv-status"></div>' +
      '</div>';
    document.body.appendChild(root);

    q('.igsv-back', root).addEventListener('click', returnToList);
    q('.igsv-full', root).addEventListener('click', toggleFullscreen);
    return root;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyle, { once: true });
  } else {
    injectStyle();
  }

  function updateLabels(root) {
    var l = labels();
    var back = q('.igsv-back-label', root);
    var full = q('.igsv-full-label', root);
    if (back) back.textContent = l.list;
    var stage = q('.igsv-stage', root);
    var isFull = !!(document.fullscreenElement && stage && document.fullscreenElement === stage);
    if (full) full.textContent = isFull ? l.exitFullscreen : l.fullscreen;
    var b = q('.igsv-back', root);
    var f = q('.igsv-full', root);
    if (b) b.setAttribute('aria-label', l.list);
    if (f) f.setAttribute('aria-label', isFull ? l.exitFullscreen : l.fullscreen);
  }

  function showStatus(message) {
    var root = ensureViewer();
    var status = q('.igsv-status', root);
    if (!status) return;
    status.textContent = message || '';
    status.hidden = !message;
  }

  function clearStage(stage) {
    if (!stage) return;
    var frame = q('.igsv-frame', stage);
    if (frame) frame.remove();
    var shell = q('.igsv-fb-shell', stage);
    if (shell) shell.remove();
    var scroll = q('.igsv-scroll', stage);
    if (scroll) scroll.remove();
    stage.setAttribute('data-aspect', 'auto');
    stage.removeAttribute('data-provider');
  }

  function notifyParentScroll(top, force) {
    top = !!top;
    if (!force && state.parentTopState === top) return;
    state.parentTopState = top;
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ IGDC_SCROLL: true, top: top }, '*');
      }
    } catch (_) {}
  }

  function bindViewerScrollHost(host) {
    if (!host || host.__igdcViewerScrollBound) return;
    host.__igdcViewerScrollBound = true;
    function sync() { notifyParentScroll((host.scrollTop || 0) <= 2, true); }
    host.addEventListener('scroll', sync, { passive: true });
    host.addEventListener('wheel', function (event) {
      var dy = Number(event && event.deltaY || 0);
      if (dy > 0) notifyParentScroll(false, true);
      else if (dy < 0 && (host.scrollTop || 0) <= 2) notifyParentScroll(true, true);
    }, { passive: true });
    sync();
  }

  function formatCount(value) {
    var n = Number(value || 0);
    if (!Number.isFinite(n) || n < 0) n = 0;
    try { return new Intl.NumberFormat(language() || 'en').format(n); } catch (_) { return String(Math.round(n)); }
  }

  function makeText(tag, className, value) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text(value);
    return el;
  }

  function ensureYouTubeLiveBox(detail) {
    if (!detail) return null;
    var box = q('.igsv-yt-live', detail);
    if (box) return box;
    box = document.createElement('div');
    box.className = 'igsv-yt-live';
    box.innerHTML = '<div class="igsv-yt-note"></div>';
    q('.igsv-yt-note', box).textContent = labels().ytChecking;
    detail.appendChild(box);
    return box;
  }

  function makeActionButton(label, extraClass) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'igsv-yt-action' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    return btn;
  }

  function mountProviderUtilityActions(detail, platform, title, sourceUrl) {
    if (!detail || platform === 'youtube') return;
    var tools = document.createElement('div');
    tools.className = 'igsv-provider-tools';

    var shareBtn = makeActionButton('↗ ' + labels().ytShare);
    shareBtn.addEventListener('click', function () {
      shareSource(title || platform || document.title, sourceUrl || state.lastUrl || '', shareBtn);
    });
    tools.appendChild(shareBtn);

    var saveBtn = makeActionButton((isSavedUrl(sourceUrl || state.lastUrl || '') ? '✓ ' + labels().ytSaved : '▣ ' + labels().ytSave));
    saveBtn.addEventListener('click', function () {
      var target = sourceUrl || state.lastUrl || '';
      var saved = toggleSavedUrl(target);
      saveBtn.textContent = saved ? '✓ ' + labels().ytSaved : '▣ ' + labels().ytSave;
    });
    tools.appendChild(saveBtn);

    detail.appendChild(tools);
  }

  function facebookPluginFrame(src, className, title, height) {
    var frame = document.createElement('iframe');
    frame.className = className || '';
    frame.src = src;
    frame.title = title || 'Facebook';
    frame.loading = 'eager';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'clipboard-write; web-share';
    frame.setAttribute('sandbox', iframeSandboxFor('facebook', { provider: 'facebook-social-plugin' }));
    if (height) frame.style.height = String(height) + 'px';
    return frame;
  }

  function facebookPluginUrl(kind, sourceUrl, width) {
    if (!validHttp(sourceUrl)) return '';
    var base = 'https://www.facebook.com/plugins/';
    width = Math.max(320, Math.min(1200, Math.floor(Number(width || 0) || 750)));
    if (kind === 'like') {
      return base + 'like.php?' + new URLSearchParams({
        href: sourceUrl,
        width: String(width),
        layout: 'standard',
        action: 'like',
        size: 'large',
        share: 'true',
        height: '76'
      }).toString();
    }
    if (kind === 'comments') {
      return base + 'comments.php?' + new URLSearchParams({
        href: sourceUrl,
        numposts: '8',
        width: String(width),
        order_by: 'social'
      }).toString();
    }
    return '';
  }

  function mountFacebookOfficialActions(host, sourceUrl) {
    if (!host || !validHttp(sourceUrl)) return;
    var box = document.createElement('div');
    box.className = 'igsv-fb-official';
    var width = Math.max(320, Math.floor((host.getBoundingClientRect().width || window.innerWidth || 750) - 96));

    /* Meta-owned Like/Reaction + Share surface. Authentication and the reaction
       picker stay inside Facebook's official social plugin. IGDC does not synthesize
       a successful reaction. */
    var likeSrc = facebookPluginUrl('like', sourceUrl, width);
    if (likeSrc) box.appendChild(facebookPluginFrame(likeSrc, 'igsv-fb-like-frame', 'Facebook Like and Share', 76));

    var head = document.createElement('div');
    head.className = 'igsv-fb-comments-head';
    var toggle = makeText('button', 'igsv-fb-comments-toggle', labels().ytOpenComments);
    toggle.type = 'button';
    head.appendChild(toggle);

    var saveBtn = makeActionButton((isSavedUrl(sourceUrl) ? '✓ ' + labels().ytSaved : '▣ ' + labels().ytSave), 'igsv-fb-save');
    saveBtn.addEventListener('click', function () {
      var saved = toggleSavedUrl(sourceUrl);
      saveBtn.textContent = saved ? '✓ ' + labels().ytSaved : '▣ ' + labels().ytSave;
    });
    head.appendChild(saveBtn);
    box.appendChild(head);

    var commentsWrap = document.createElement('div');
    commentsWrap.className = 'igsv-fb-comments-wrap';
    commentsWrap.hidden = true;
    box.appendChild(commentsWrap);

    var commentsFrame = null;
    toggle.addEventListener('click', function () {
      var opening = commentsWrap.hidden;
      commentsWrap.hidden = !opening;
      toggle.textContent = opening ? labels().ytCloseComments : labels().ytOpenComments;
      if (opening && !commentsFrame) {
        var src = facebookPluginUrl('comments', sourceUrl, width);
        if (src) {
          commentsFrame = facebookPluginFrame(src, 'igsv-fb-comments-frame', 'Facebook Comments');
          commentsWrap.appendChild(commentsFrame);
        }
      }
    });

    host.appendChild(box);
  }

  function mountFacebookPostDocument(stage, title, description, sourceUrl) {
    stage.setAttribute('data-aspect', 'auto');
    stage.setAttribute('data-provider', 'facebook-post');
    var scroll = document.createElement('div');
    scroll.className = 'igsv-scroll';
    var content = document.createElement('div');
    content.className = 'igsv-content';

    var media = document.createElement('div');
    media.className = 'igsv-fb-owned-media';
    var preview = text(state.lastPreview || '').trim();
    var image = null;
    media.hidden = !validHttp(preview);
    if (validHttp(preview)) {
      image = document.createElement('img');
      image.src = preview;
      image.alt = title || 'Facebook post';
      image.loading = 'eager';
      image.referrerPolicy = 'no-referrer';
      media.appendChild(image);
    }
    content.appendChild(media);

    var detail = buildDetail(title || 'Facebook', description || '', 'facebook');
    content.appendChild(detail);
    mountFacebookOfficialActions(content, sourceUrl);

    var safeSpace = document.createElement('div');
    safeSpace.className = 'igsv-safe-space';
    safeSpace.setAttribute('aria-hidden', 'true');
    content.appendChild(safeSpace);
    scroll.appendChild(content);
    stage.appendChild(scroll);
    bindViewerScrollHost(scroll);

    loadFacebookPublicDetail(detail, sourceUrl, image, media);
    showStatus('');
    return true;
  }

  function iframeSandboxFor(platform, embed) {
    var strict = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-downloads';
    /* Keep the IGDC top-level page contained. Facebook's official post plugin does,
       however, use user-initiated popup/dialog flows for login, reactions, comments
       and share in some browser states. Let ONLY those popups escape the iframe
       sandbox so the provider dialog can function, while deliberately omitting every
       allow-top-navigation token: the IGDC tab itself can never become facebook.com. */
    if (embed && embed.restrictedProvider) return strict;
    var allowed = strict + ' allow-popups allow-modals allow-storage-access-by-user-activation';
    if (platform === 'facebook' || (embed && /^facebook-/.test(text(embed.provider)))) {
      allowed += ' allow-popups-to-escape-sandbox';
    }
    return allowed;
  }

  function showOAuthHint(box) {
    if (!box) return;
    var hint = q('.igsv-yt-oauth-hint', box);
    if (!hint) {
      hint = makeText('div', 'igsv-yt-oauth-hint', labels().ytOAuth);
      box.appendChild(hint);
    }
    hint.classList.add('show');
    window.clearTimeout(hint.__hideTimer);
    hint.__hideTimer = window.setTimeout(function () { hint.classList.remove('show'); }, 4500);
  }

  function savedUrls() {
    try {
      var rows = JSON.parse(localStorage.getItem('IGDC_SOCIAL_SAVED_V1') || '[]');
      return Array.isArray(rows) ? rows.filter(function (v) { return validHttp(v); }).slice(-200) : [];
    } catch (_) { return []; }
  }

  function toggleSavedUrl(url) {
    if (!validHttp(url)) return false;
    var rows = savedUrls();
    var idx = rows.indexOf(url);
    var saved;
    if (idx >= 0) { rows.splice(idx, 1); saved = false; }
    else { rows.push(url); saved = true; }
    try { localStorage.setItem('IGDC_SOCIAL_SAVED_V1', JSON.stringify(rows.slice(-200))); } catch (_) {}
    return saved;
  }

  function isSavedUrl(url) { return savedUrls().indexOf(url) >= 0; }

  function shareSource(title, url, button) {
    if (!validHttp(url)) return;
    function mark() {
      if (!button) return;
      var before = button.textContent;
      button.textContent = '✓ ' + labels().ytShare;
      window.setTimeout(function () { if (button) button.textContent = before; }, 1600);
    }
    if (navigator.share) {
      navigator.share({ title: title || document.title, url: url }).then(mark).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(mark).catch(function () {});
      return;
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      mark();
    } catch (_) {}
  }


  function setYouTubeOAuthStatus(status) {
    state.youtubeOAuthStatus = status || 'unknown';
    var root = document.getElementById('igdcSocialViewerV2');
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('.igsv-yt-auth-state'), function (node) {
      node.textContent = state.youtubeOAuthStatus === 'authorized' ? labels().ytConnected : '';
    });
  }

  function checkYouTubeOAuthStatus() {
    fetch('/.netlify/functions/social-youtube-action', { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (!state.open || state.platform !== 'youtube') return;
        if (data && data.configured === false) setYouTubeOAuthStatus('unconfigured');
        else setYouTubeOAuthStatus(data && data.authorized ? 'authorized' : 'required');
      })
      .catch(function () { if (state.open && state.platform === 'youtube') setYouTubeOAuthStatus('unknown'); });
  }

  function openYouTubeOAuthPopup(onDone) {
    var width = 540, height = 720;
    var left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || screen.width || width) - width) / 2));
    var top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || screen.height || height) - height) / 2));
    var popup = null;
    try {
      popup = window.open('/.netlify/functions/social-youtube-oauth-start', 'igdcSocialYouTubeOAuth', 'popup=yes,width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes');
    } catch (_) {}
    if (!popup) {
      setYouTubeOAuthStatus('required');
      if (typeof onDone === 'function') onDone(false, 'popup_blocked');
      return;
    }
    state.youtubeOAuthPopup = popup;
    setYouTubeOAuthStatus('connecting');
    var settled = false;
    function finish(ok, error) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(closePoll);
      state.youtubeOAuthPopup = null;
      setYouTubeOAuthStatus(ok ? 'authorized' : 'required');
      if (typeof onDone === 'function') onDone(!!ok, error || '');
    }
    function onMessage(event) {
      if (event.origin !== location.origin) return;
      var data = event.data || {};
      if (data.type !== 'IGDC_SOCIAL_OAUTH' || data.provider !== 'youtube') return;
      finish(data.ok === true, data.error || '');
    }
    window.addEventListener('message', onMessage);
    var closePoll = window.setInterval(function () {
      try { if (popup.closed) finish(state.youtubeOAuthStatus === 'authorized', 'popup_closed'); } catch (_) {}
    }, 500);
  }

  function youtubeWriteAction(action, payload, button, onSuccess) {
    var body = Object.assign({}, payload || {}, { action: action });
    var retriedAfterOAuth = false;
    function execute() {
      if (button) button.disabled = true;
      return fetch('/.netlify/functions/social-youtube-action', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
      }).then(function (result) {
        if (button) button.disabled = false;
        if (result.data && result.data.ok) {
          setYouTubeOAuthStatus('authorized');
          if (typeof onSuccess === 'function') onSuccess(result.data);
          return true;
        }
        if (result.data && result.data.oauthRequired) {
          setYouTubeOAuthStatus('required');
          if (!retriedAfterOAuth) {
            retriedAfterOAuth = true;
            openYouTubeOAuthPopup(function (ok) { if (ok) execute(); });
          }
          return false;
        }
        if (button) {
          var original = button.textContent;
          button.textContent = labels().ytActionFailed;
          window.setTimeout(function () { if (button) button.textContent = original; }, 1800);
        }
        return true;
      }).catch(function () {
        if (button) button.disabled = false;
        return true;
      });
    }

    if (state.youtubeOAuthStatus === 'authorized') { execute(); return; }
    retriedAfterOAuth = true;
    openYouTubeOAuthPopup(function (ok) { if (ok) execute(); });
  }

  function refreshDescriptionToggle(detail) {
    if (!detail) return;
    var desc = q('.igsv-detail-desc', detail);
    var toggle = q('.igsv-detail-toggle', detail);
    if (!desc || !toggle) return;
    desc.classList.add('is-collapsed');
    desc.classList.remove('expanded');
    toggle.textContent = labels().ytMore;
    toggle.hidden = true;
    window.requestAnimationFrame(function () {
      if (!desc.isConnected) return;
      toggle.hidden = !(desc.scrollHeight > desc.clientHeight + 2);
    });
  }

  function buildDetail(title, description, platform) {
    var detail = document.createElement('div');
    detail.className = 'igsv-detail';
    detail.setAttribute('data-platform', platform || '');
    var detailTitle = makeText('div', 'igsv-detail-title', title || platform || 'Social');
    detail.appendChild(detailTitle);
    var wrap = document.createElement('div');
    wrap.className = 'igsv-detail-desc-wrap';
    var desc = makeText('div', 'igsv-detail-desc is-collapsed', description || '');
    if (!description) wrap.style.display = 'none';
    wrap.appendChild(desc);
    var toggle = makeText('button', 'igsv-detail-toggle', labels().ytMore);
    toggle.type = 'button';
    toggle.hidden = true;
    toggle.addEventListener('click', function () {
      var expanded = desc.classList.toggle('expanded');
      desc.classList.toggle('is-collapsed', !expanded);
      toggle.textContent = expanded ? labels().ytLess : labels().ytMore;
    });
    wrap.appendChild(toggle);
    detail.appendChild(wrap);
    if (description) window.setTimeout(function () { refreshDescriptionToggle(detail); }, 0);
    return detail;
  }

  function updateDetailDescription(detail, value) {
    var wrap = q('.igsv-detail-desc-wrap', detail);
    var desc = q('.igsv-detail-desc', detail);
    if (!wrap || !desc) return;
    desc.textContent = value || '';
    wrap.style.display = value ? '' : 'none';
    if (value) refreshDescriptionToggle(detail);
  }

  function loadFacebookPublicDetail(detail, sourceUrl, imageEl, mediaEl) {
    if (!detail || !validHttp(sourceUrl)) return;
    fetch('/.netlify/functions/social-facebook-public-detail?url=' + encodeURIComponent(sourceUrl), {
      method: 'GET', credentials: 'same-origin', cache: 'default'
    }).then(function (res) {
      if (!res.ok) throw new Error('http_' + res.status);
      return res.json();
    }).then(function (data) {
      if (!state.open || state.platform !== 'facebook' || state.lastUrl !== sourceUrl) return;
      if (!data || !data.ok) return;
      var titleEl = q('.igsv-detail-title', detail);
      if (titleEl && data.title) titleEl.textContent = decodeEntities(data.title);
      if (data.description) updateDetailDescription(detail, decodeEntities(data.description));
      if (data.image && validHttp(data.image)) {
        if (!imageEl && mediaEl) {
          imageEl = document.createElement('img');
          imageEl.alt = titleEl ? titleEl.textContent : 'Facebook post';
          imageEl.loading = 'eager';
          imageEl.referrerPolicy = 'no-referrer';
          mediaEl.appendChild(imageEl);
        }
        if (mediaEl) mediaEl.hidden = false;
        if (imageEl && imageEl.src !== data.image) imageEl.src = data.image;
      }
    }).catch(function () {
      /* Stored snapshot title/description remain visible; viewer never blocks. */
    });
  }

  function renderYouTubeDetail(detail, payload, requestedOrder) {
    if (!detail || !payload || !payload.ok) return;
    var video = payload.video || {};
    var channel = payload.channel || {};
    var stats = video.statistics || {};
    var titleEl = q('.igsv-detail-title', detail);
    if (titleEl && video.title) titleEl.textContent = video.title;
    if (video.description) updateDetailDescription(detail, video.description);

    var box = ensureYouTubeLiveBox(detail);
    if (!box) return;
    box.textContent = '';

    var channelRow = document.createElement('div');
    channelRow.className = 'igsv-yt-channel';
    if (channel.thumbnail) {
      var avatar = document.createElement('img');
      avatar.className = 'igsv-yt-avatar';
      avatar.alt = '';
      avatar.loading = 'lazy';
      avatar.src = channel.thumbnail;
      channelRow.appendChild(avatar);
    }
    var copy = document.createElement('div');
    copy.className = 'igsv-yt-channel-copy';
    copy.appendChild(makeText('div', 'igsv-yt-channel-name', channel.title || video.channelTitle || 'YouTube'));
    if (channel.subscriberCount != null && !channel.hiddenSubscriberCount) {
      copy.appendChild(makeText('div', 'igsv-yt-subs', labels().ytSubscriber + ' ' + formatCount(channel.subscriberCount)));
    }
    channelRow.appendChild(copy);

    var channelActions = document.createElement('div');
    channelActions.className = 'igsv-yt-channel-actions';
    var subBtn = makeActionButton(labels().ytSubscribe, 'is-primary');
    subBtn.addEventListener('click', function () {
      youtubeWriteAction('subscribe', { channelId: channel.id || video.channelId || '' }, subBtn, function () {
        subBtn.textContent = '✓ ' + labels().ytSubscribed;
      });
    });
    channelActions.appendChild(subBtn);
    channelRow.appendChild(channelActions);
    box.appendChild(channelRow);

    var actions = document.createElement('div');
    actions.className = 'igsv-yt-actions';
    if (stats.viewCount != null) actions.appendChild(makeText('div', 'igsv-yt-views', labels().ytViews + ' ' + formatCount(stats.viewCount)));
    var likeBtn = makeActionButton('♡ ' + labels().ytLikes + (stats.likeCount != null ? ' ' + formatCount(stats.likeCount) : ''));
    likeBtn.addEventListener('click', function () {
      youtubeWriteAction('like', { videoId: video.id || videoIdYouTube(state.lastUrl || '') }, likeBtn, function () {
        likeBtn.textContent = '♥ ' + labels().ytLiked + (stats.likeCount != null ? ' ' + formatCount(Number(stats.likeCount || 0) + 1) : '');
      });
    });
    actions.appendChild(likeBtn);
    var shareBtn = makeActionButton('↗ ' + labels().ytShare);
    shareBtn.addEventListener('click', function () { shareSource(video.title || '', state.lastUrl || '', shareBtn); });
    actions.appendChild(shareBtn);
    var saveBtn = makeActionButton((isSavedUrl(state.lastUrl || '') ? '✓ ' + labels().ytSaved : '▣ ' + labels().ytSave));
    saveBtn.addEventListener('click', function () {
      var saved = toggleSavedUrl(state.lastUrl || '');
      saveBtn.textContent = saved ? '✓ ' + labels().ytSaved : '▣ ' + labels().ytSave;
    });
    actions.appendChild(saveBtn);
    if (video.publishedAt) {
      try { actions.appendChild(makeText('span', 'igsv-yt-pill', new Date(video.publishedAt).toLocaleDateString())); } catch (_) {}
    }
    box.appendChild(actions);

    var oauthHint = makeText('div', 'igsv-yt-oauth-hint', labels().ytOAuth);
    box.appendChild(oauthHint);
    var authState = makeText('div', 'igsv-yt-auth-state', state.youtubeOAuthStatus === 'authorized' ? labels().ytConnected : '');
    box.appendChild(authState);

    var comments = Array.isArray(payload.comments) ? payload.comments : [];
    var commentCount = stats.commentCount != null ? Number(stats.commentCount || 0) : comments.length;
    var commentsBox = document.createElement('div');
    commentsBox.className = 'igsv-yt-comments';
    var head = document.createElement('div');
    head.className = 'igsv-yt-comments-head';
    head.appendChild(makeText('h2', 'igsv-yt-comments-title', labels().ytComments + ' ' + formatCount(commentCount)));
    var sortWrap = document.createElement('label');
    sortWrap.className = 'igsv-yt-sort';
    sortWrap.appendChild(document.createTextNode(labels().ytSort));
    var select = document.createElement('select');
    var topOpt = new Option(labels().ytSortTop, 'relevance');
    var newOpt = new Option(labels().ytSortNewest, 'time');
    select.appendChild(topOpt);
    select.appendChild(newOpt);
    select.value = payload.commentOrder || requestedOrder || 'relevance';
    select.addEventListener('change', function () { loadYouTubeDetail(detail, state.lastUrl || '', select.value); });
    sortWrap.appendChild(select);
    head.appendChild(sortWrap);

    /* Keep the comment expand/collapse control beside the comment count and
       sort control. Users should never have to scroll to the end of a long
       comment list just to collapse it again. */
    var commentsToggle = null;
    if (comments.length > 3) {
      commentsToggle = makeText('button', 'igsv-yt-comments-toggle', labels().ytOpenComments);
      commentsToggle.type = 'button';
      commentsToggle.addEventListener('click', function () {
        var hidden = q('.igsv-yt-comment.is-hidden', commentsBox);
        var open = !!hidden;
        Array.prototype.forEach.call(commentsBox.querySelectorAll('.igsv-yt-comment'), function (node, index) {
          node.classList.toggle('is-hidden', open ? false : index >= 3);
        });
        commentsToggle.textContent = open ? labels().ytCloseComments : labels().ytOpenComments;
        commentsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      commentsToggle.setAttribute('aria-expanded', 'false');
      head.appendChild(commentsToggle);
    }
    commentsBox.appendChild(head);

    var compose = document.createElement('div');
    compose.className = 'igsv-yt-comment-compose';
    var composeDot = document.createElement('span');
    composeDot.className = 'igsv-yt-compose-dot';
    composeDot.setAttribute('aria-hidden', 'true');
    var commentInput = document.createElement('textarea');
    commentInput.className = 'igsv-yt-comment-input';
    commentInput.rows = 2;
    commentInput.maxLength = 10000;
    commentInput.placeholder = labels().ytCommentAdd;
    var commentSubmit = makeText('button', 'igsv-yt-comment-submit', labels().ytCommentPost);
    commentSubmit.type = 'button';
    commentSubmit.disabled = true;
    commentInput.addEventListener('input', function () { commentSubmit.disabled = !text(commentInput.value); });
    commentSubmit.addEventListener('click', function () {
      var value = text(commentInput.value);
      if (!value) return;
      youtubeWriteAction('comment', { videoId: video.id || videoIdYouTube(state.lastUrl || ''), comment: value }, commentSubmit, function () {
        commentInput.value = '';
        commentSubmit.disabled = true;
        window.setTimeout(function () { loadYouTubeDetail(detail, state.lastUrl || '', select.value); }, 450);
      });
    });
    commentInput.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && text(commentInput.value)) {
        event.preventDefault();
        commentSubmit.click();
      }
    });
    compose.appendChild(composeDot);
    compose.appendChild(commentInput);
    compose.appendChild(commentSubmit);
    commentsBox.appendChild(compose);

    comments.forEach(function (row, index) {
      var item = document.createElement('div');
      item.className = 'igsv-yt-comment' + (index >= 3 ? ' is-hidden' : '');
      if (row.authorAvatar) {
        var ca = document.createElement('img');
        ca.className = 'igsv-yt-comment-avatar';
        ca.alt = '';
        ca.loading = 'lazy';
        ca.src = row.authorAvatar;
        item.appendChild(ca);
      }
      var body = document.createElement('div');
      body.className = 'igsv-yt-comment-body';
      var author = row.author || 'YouTube';
      if (row.publishedAt) { try { author += ' · ' + new Date(row.publishedAt).toLocaleDateString(); } catch (_) {} }
      body.appendChild(makeText('div', 'igsv-yt-comment-head', author));
      var commentText = makeText('div', 'igsv-yt-comment-text', row.text || '');
      body.appendChild(commentText);
      if (text(row.text).length > 180) {
        var more = makeText('button', 'igsv-yt-comment-more', labels().ytMore);
        more.type = 'button';
        more.addEventListener('click', function () {
          var expanded = commentText.classList.toggle('expanded');
          more.textContent = expanded ? labels().ytLess : labels().ytMore;
        });
        body.appendChild(more);
      }
      if (row.likeCount != null) body.appendChild(makeText('div', 'igsv-yt-comment-like', '♡ ' + formatCount(row.likeCount)));
      item.appendChild(body);
      commentsBox.appendChild(item);
    });

    box.appendChild(commentsBox);
    box.appendChild(makeText('div', 'igsv-yt-note', labels().ytPublicNote));
  }

  function loadYouTubeDetail(detail, sourceUrl, order) {
    var id = videoIdYouTube(sourceUrl);
    if (!detail || !id) return;
    order = order === 'time' ? 'time' : 'relevance';
    var token = ++state.youtubeDetailToken;
    if (state.youtubeOAuthStatus === 'unknown') checkYouTubeOAuthStatus();
    var box = ensureYouTubeLiveBox(detail);
    if (box) {
      box.textContent = '';
      box.appendChild(makeText('div', 'igsv-yt-note', labels().ytChecking));
    }
    fetch('/.netlify/functions/social-youtube-public-detail?videoId=' + encodeURIComponent(id) + '&order=' + encodeURIComponent(order), {
      method: 'GET', credentials: 'same-origin', cache: 'default'
    }).then(function (res) {
      if (!res.ok) throw new Error('http_' + res.status);
      return res.json();
    }).then(function (data) {
      if (!state.open || token !== state.youtubeDetailToken || state.platform !== 'youtube') return;
      if (data && data.ok) renderYouTubeDetail(detail, data, order);
      else if (box) { box.textContent = ''; box.appendChild(makeText('div', 'igsv-yt-note', labels().ytDetailUnavailable)); }
    }).catch(function () {
      if (!state.open || token !== state.youtubeDetailToken || state.platform !== 'youtube') return;
      if (box) { box.textContent = ''; box.appendChild(makeText('div', 'igsv-yt-note', labels().ytDetailUnavailable)); }
    });
  }

  function sizeProviderFrame(stage, iframe, embed) {
    if (!stage || !iframe || !embed || embed.provider !== 'facebook-post') return;
    var rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    /* Facebook only exposes an embeddable POST document, not the full facebook.com
       page. Its provider width tops out at 750px. Scale that official document to
       the IGDC viewer width, but keep a real scroll container and a viewport-sized
       iframe so the user sees a browser-filling document rather than a tiny card
       floating above a large blank canvas. */
    var providerWidth = Number(iframe.__igdcFacebookWidth || 0) || Math.max(350, Math.min(750, Math.floor(rect.width)));
    var scale = Math.max(1, rect.width / providerWidth);

    /* The Facebook post plugin does not publish its cross-origin document height
       back to IGDC. A viewport-derived 520px frame can therefore cut the post
       exactly where the caption/body begins. Keep enough provider-side document
       height for image + text and reserve visible breathing room below the post. */
    var visibleRawHeight = Math.ceil(rect.height / scale);
    /* Leave enough provider document height for Facebook's native reaction/comment/
       share footer. The shell still owns viewport scrolling. */
    var rawHeight = Math.max(760, visibleRawHeight + 90);
    var bottomReservePx = 90;
    var bottomReserveRaw = Math.max(1, Math.ceil(bottomReservePx / scale));
    var canvasRawHeight = rawHeight + bottomReserveRaw;
    var shell = iframe.closest('.igsv-fb-shell');
    var canvas = iframe.closest('.igsv-fb-canvas');

    iframe.style.width = providerWidth + 'px';
    iframe.style.height = rawHeight + 'px';
    iframe.style.left = '0';
    iframe.style.top = '0';
    iframe.style.transform = 'none';

    if (canvas) {
      canvas.style.width = providerWidth + 'px';
      canvas.style.height = canvasRawHeight + 'px';
      canvas.style.transform = 'scale(' + scale + ')';
      canvas.style.transformOrigin = 'top left';
      canvas.style.margin = '0';
    }
    if (shell) {
      shell.style.width = '100%';
      shell.style.height = '100%';
      var fbDetail = q('.igsv-fb-detail', shell);
      if (fbDetail) {
        /* CSS transforms do not add their scaled visual height to normal flow. */
        fbDetail.style.marginTop = Math.max(0, Math.ceil(canvasRawHeight * scale - canvasRawHeight)) + 'px';
      }
      shell.scrollTop = Math.min(shell.scrollTop, Math.max(0, shell.scrollHeight - rect.height));
    }
  }

  function mountEmbed(root, embed, title, description, platform) {
    var stage = q('.igsv-stage', root);
    clearStage(stage);
    if (!embed || !embed.src) {
      showStatus(labels().unavailable);
      return false;
    }

    showStatus(labels().loading);
    stage.setAttribute('data-aspect', embed.aspect || 'auto');
    if (embed.provider) stage.setAttribute('data-provider', embed.provider);
    if (embed.provider === 'facebook-post') {
      /* Do not render Facebook's cross-origin post shell as the visible document.
         Its internal `See more` link can only navigate within Facebook and its
         natural cross-origin height cannot be measured reliably, which produced
         the large blank gaps seen in some posts. Render the stored/public media
         and text as an IGDC-owned document, then attach Meta's official Like/
         Reaction, Share and Comments plugins below it. */
      return mountFacebookPostDocument(stage, title, description, state.lastUrl || '');
    }
    var iframe = document.createElement('iframe');
    iframe.className = 'igsv-frame';
    var frameSrc = embed.src;
    if (embed.provider === 'facebook-post') {
      var stageRect = stage.getBoundingClientRect();
      var providerWidth = Math.max(350, Math.min(750, Math.floor(stageRect.width || 750)));
      try {
        var fbSrc = new URL(frameSrc, location.href);
        fbSrc.searchParams.set('width', String(providerWidth));
        frameSrc = fbSrc.toString();
      } catch (_) {}
      iframe.__igdcFacebookWidth = providerWidth;
    }
    iframe.src = frameSrc;
    iframe.title = title || 'Social content';
    iframe.loading = 'eager';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share';
    iframe.setAttribute('allowfullscreen', '');
    if (embed.provider === 'facebook-post') iframe.setAttribute('scrolling', 'yes');
    /* Provider embeds stay contained. They may use an in-sandbox user popup when the
       provider requires one, but cannot replace the IGDC tab and cannot create an
       unsandboxed external browsing context. */
    iframe.setAttribute('sandbox', iframeSandboxFor(platform, embed));
    iframe.addEventListener('load', function () {
      sizeProviderFrame(stage, iframe, embed);
      showStatus('');
    }, { once: true });
    if (embed.provider === 'facebook-post') {
      var shell = document.createElement('div');
      shell.className = 'igsv-fb-shell';
      var canvas = document.createElement('div');
      canvas.className = 'igsv-fb-canvas';
      canvas.appendChild(iframe);
      shell.appendChild(canvas);

      /* Facebook's cross-origin `더보기/See more` cannot be allowed to replace the
         IGDC top-level page. The provider text is therefore hidden in the plugin
         (`show_text=false`) and rendered as an IGDC-owned expandable detail block.
         Native reactions/comments/share remain provider-owned inside the official
         Facebook plugin; no fake success UI is introduced. */
      var fbDetail = buildDetail(title || platform, description || '', platform);
      fbDetail.classList.add('igsv-fb-detail');
      shell.appendChild(fbDetail);
      mountProviderUtilityActions(fbDetail, platform, title || platform, state.lastUrl || '');
      loadFacebookPublicDetail(fbDetail, state.lastUrl || '');

      var fbSafe = document.createElement('div');
      fbSafe.className = 'igsv-safe-space';
      fbSafe.setAttribute('aria-hidden', 'true');
      shell.appendChild(fbSafe);

      stage.appendChild(shell);
      bindViewerScrollHost(shell);
    } else {
      /* All nine main SNS viewers share one scroll contract: the provider media
         sits in a full-width content document and a consistent 90px safe area remains
         below it. The browser only paints a vertical scrollbar when that document
         is taller than the available viewer stage (overflow:auto). */
      var scroll = document.createElement('div');
      scroll.className = 'igsv-scroll';
      var content = document.createElement('div');
      content.className = 'igsv-content';
      var media = document.createElement('div');
      media.className = 'igsv-media';
      media.setAttribute('data-aspect', embed.aspect || 'auto');
      if (embed.provider) media.setAttribute('data-provider', embed.provider);
      media.appendChild(iframe);
      content.appendChild(media);

      /* Every non-Facebook-post provider receives the same full-width white
         information document beneath its official player/embed. Provider-native
         interaction remains inside the official iframe; IGDC only adds published
         title/description and (for YouTube) public detail controls. */
      var detail = buildDetail(title || platform, description || '', platform);
      content.appendChild(detail);
      if (platform === 'youtube') loadYouTubeDetail(detail, state.lastUrl || '', 'relevance');
      else if (platform === 'facebook') mountFacebookOfficialActions(content, state.lastUrl || '');
      else mountProviderUtilityActions(detail, platform, title || platform, state.lastUrl || '');

      var safeSpace = document.createElement('div');
      safeSpace.className = 'igsv-safe-space';
      safeSpace.setAttribute('aria-hidden', 'true');
      content.appendChild(safeSpace);
      scroll.appendChild(content);
      stage.appendChild(scroll);
      bindViewerScrollHost(scroll);
    }
    sizeProviderFrame(stage, iframe, embed);
    iframe.__igdcSocialEmbed = embed;

    /* If a provider never fires load, do not leave the loading veil forever. */
    window.setTimeout(function () {
      if (state.open && q('.igsv-frame', stage) === iframe) showStatus('');
    }, 4500);
    return true;
  }

  function openCard(card) {
    var platform = sectionPlatform(card);
    var url = firstUrl(card);
    if (!platform || !url) return false;

    var root = ensureViewer();
    var title = titleOf(card) || platform;
    var description = descOf(card);
    var embed = buildEmbed(platform, url, card);

    state.previousFocus = document.activeElement;
    state.lastUrl = url;
    state.lastPreview = previewUrlOf(card);
    state.platform = platform;
    state.open = true;
    state.closingFromHistory = false;
    state.parentTopState = null;

    q('.igsv-title', root).textContent = title;
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    updateLabels(root);
    mountEmbed(root, embed, title, description, platform);

    if (!state.pushed) {
      try {
        history.pushState({ igdcSocialViewerV2: true, platform: platform }, '', location.href);
        state.pushed = true;
      } catch (_) {
        state.pushed = false;
      }
    }
    try { q('.igsv-back', root).focus({ preventScroll: true }); } catch (_) {}
    return true;
  }

  function finishClose() {
    var root = document.getElementById('igdcSocialViewerV2');
    if (root) {
      root.classList.remove('open');
      root.setAttribute('aria-hidden', 'true');
      clearStage(q('.igsv-stage', root));
      showStatus('');
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    state.open = false;
    state.pushed = false;
    state.closingFromHistory = false;
    state.lastUrl = '';
    state.lastPreview = '';
    state.platform = '';
    state.parentTopState = null;
    state.youtubeDetailToken++;
    var focus = state.previousFocus;
    state.previousFocus = null;
    if (focus && focus.focus) {
      try { focus.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  function returnToList() {
    if (!state.open) return;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    if (state.pushed && !state.closingFromHistory) {
      try {
        history.back();
        return;
      } catch (_) {}
    }
    finishClose();
  }

  function toggleFullscreen() {
    if (!state.open) return;
    var root = ensureViewer();
    var stage = q('.igsv-stage', root);
    if (!stage) return;
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
      return;
    }
    if (stage.requestFullscreen) {
      stage.requestFullscreen().catch(function () {});
    }
  }

  function resizeActiveProviderFrame() {
    if (!state.open) return;
    var root = document.getElementById('igdcSocialViewerV2');
    var stage = root && q('.igsv-stage', root);
    var iframe = stage && q('.igsv-frame', stage);
    if (stage && iframe && iframe.__igdcSocialEmbed) {
      sizeProviderFrame(stage, iframe, iframe.__igdcSocialEmbed);
    }
  }

  document.addEventListener('fullscreenchange', function () {
    var root = document.getElementById('igdcSocialViewerV2');
    if (root && state.open) {
      updateLabels(root);
      window.setTimeout(resizeActiveProviderFrame, 30);
    }
    /* Deliberately DO NOT close the viewer when native fullscreen ends.
       This provides the required two-step return: fullscreen -> in-page player -> list. */
  });

  window.addEventListener('resize', function () {
    if (state.open) resizeActiveProviderFrame();
  }, { passive: true });

  window.addEventListener('orientationchange', function () {
    if (state.open) window.setTimeout(resizeActiveProviderFrame, 80);
  }, { passive: true });

  window.addEventListener('popstate', function () {
    if (!state.open) return;
    state.closingFromHistory = true;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    finishClose();
  });

  document.addEventListener('keydown', function (event) {
    if (!state.open || event.key !== 'Escape') return;
    /* Native fullscreen owns the first Escape. fullscreenchange keeps the viewer open. */
    if (document.fullscreenElement) return;
    event.preventDefault();
    event.stopPropagation();
    returnToList();
  }, true);

  function previewUrlOf(card) {
    if (!card) return '';
    var pic = q('.pic', card);
    var img = q('img', card);
    var d = card.dataset || {};
    return text(d.thumbnailUrl || d.thumb || d.image || (img && img.src) || getBgUrl(pic)).trim();
  }

  function facebookPreviewNeedsRefresh(card) {
    var platform = sectionPlatform(card);
    if (platform !== 'facebook') return false;
    var src = previewUrlOf(card);
    if (!src) return true;
    try {
      var u = new URL(src, location.href);
      if (!/(?:^|\.)fbcdn\.net$/i.test(u.hostname)) return false;
      var token = u.searchParams.get('oe');
      if (!token || !/^[0-9a-f]+$/i.test(token)) return false;
      var expiry = parseInt(token, 16) * 1000;
      return Number.isFinite(expiry) && expiry <= Date.now() + 30 * 60 * 1000;
    } catch (_) { return false; }
  }

  function cardHasPreview(card) {
    if (facebookPreviewNeedsRefresh(card)) return false;
    var pic = q('.pic', card);
    if (!pic) return false;
    if (q('img,video,picture', pic)) return true;
    if (getBgUrl(pic)) return true;
    var d = card.dataset || {};
    return validHttp(d.thumbnailUrl || d.thumb || d.image || '');
  }

  function applyDecodedTitle(card) {
    var titleEl = q('.title', card);
    if (!titleEl) return;
    var raw = text(titleEl.textContent).trim();
    var decoded = decodeEntities(raw);
    if (decoded && decoded !== raw) titleEl.textContent = decoded;
    if (decoded) titleEl.setAttribute('title', decoded);
  }

  function decodeMainTextElement(el) {
    if (!el || !(el.classList && (el.classList.contains('title') || el.classList.contains('desc')))) return;
    var card = el.closest && el.closest('a.card');
    if (!isMainSocialCard(card)) return;
    var raw = text(el.textContent).trim();
    if (!raw || raw.indexOf('&') < 0) return;
    var decoded = decodeEntities(raw);
    if (decoded && decoded !== raw) el.textContent = decoded;
    if (el.classList.contains('title') && decoded) el.setAttribute('title', decoded);
  }

  function processMainTextMutation(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      decodeMainTextElement(node.parentElement);
      return;
    }
    if (node.nodeType !== 1) return;
    decodeMainTextElement(node);
    var rows = node.querySelectorAll ? node.querySelectorAll('.title,.desc') : [];
    for (var i = 0; i < rows.length; i++) decodeMainTextElement(rows[i]);
  }

  function installMainTextDecoder() {
    var roots = [];
    Object.keys(MAIN_KEYS).forEach(function (key) {
      var root = document.querySelector('.thumb-grid[data-psom-key="' + key + '"]');
      if (root) roots.push(root);
    });
    roots.forEach(function (root) {
      processMainTextMutation(root);
      if (!window.MutationObserver || root.__igdcTextDecodeObserver) return;
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          if (mutation.type === 'characterData') processMainTextMutation(mutation.target);
          else Array.prototype.forEach.call(mutation.addedNodes || [], processMainTextMutation);
        });
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      root.__igdcTextDecodeObserver = observer;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMainTextDecoder, { once: true });
  else installMainTextDecoder();

  /*
   * Preview policy v2.4
   * Do NOT issue background metadata requests from the front list.
   * Thumbnails must arrive with the published Social candidate/snapshot.
   * This keeps initial rendering DOM-only and prevents serverless preview
   * calls / MutationObserver rescan loops from delaying the page.
   */

  document.addEventListener('mouseover', function (event) {
    var titleEl = event.target && event.target.closest && event.target.closest('.title');
    if (!titleEl) return;
    var card = titleEl.closest('a.card');
    if (!isMainSocialCard(card)) return;
    var fullTitle = text(titleEl.textContent).trim();
    if (fullTitle && titleEl.getAttribute('title') !== fullTitle) titleEl.setAttribute('title', fullTitle);
  }, true);

  document.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('.rscroll')) return;
    var card = event.target && event.target.closest &&
      event.target.closest('.thumb-grid[data-psom-key] a.card');
    if (!card || !isMainSocialCard(card)) return;

    var url = firstUrl(card);
    if (!url) return; /* Placeholder/sample cards keep their existing behavior. */

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openCard(card);
  }, true);
})();
