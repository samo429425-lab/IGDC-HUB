/* IGDC policy voice console v1.1.1-language-tts-conversation
 * Upgraded, isolated reuse of the MARU Global Insight voice pattern.
 * Keeps MARU Global Insight unchanged while adding scoped dictation, one-shot voice Q&A,
 * interim transcript, language selection, error recovery, and AI response speech.
 */
(function () {
  'use strict';

  if (window.IGDCPolicyVoice) return;

  var $ = function (id) { return document.getElementById(id); };
  var SpeechRecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognition = null;
  var activeMode = null;
  var shouldRestart = false;
  var restartTimer = null;
  var askSubmitted = false;
  var busy = false;
  var lastSpeakText = '';
  var lastSpeakLanguage = '';
  var lastFocusedTarget = 'policyInstruction';
  var TARGET_IDS = [
    'policyInstruction', 'policyFinalDecision', 'policyPriorityDirections',
    'policyAvoidDirections', 'policyPriorityTargets', 'policyBlockedTargets'
  ];

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function detectTextLanguage(value) {
    var sample = text(value);
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(sample)) return 'ko-KR';
    if (/[ぁ-んァ-ヶ]/.test(sample)) return 'ja-JP';
    if (/[一-鿿]/.test(sample)) return 'zh-CN';
    if (/[؀-ۿ]/.test(sample)) return 'ar-SA';
    if (/[ऀ-ॿ]/.test(sample)) return 'hi-IN';
    if (/[฀-๿]/.test(sample)) return 'th-TH';
    return '';
  }

  function state(label, detail) {
    var stateElement = $('policyVoiceState');
    var liveElement = $('policyVoiceLive');
    if (stateElement) stateElement.textContent = label;
    if (liveElement) liveElement.textContent = detail || '';
  }

  function selectedLanguage() {
    var selected = $('policyVoiceLanguage') ? $('policyVoiceLanguage').value : 'auto';
    if (selected && selected !== 'auto') return selected;
    var instruction = $('policyInstruction');
    var target = activeTarget();
    var detected = detectTextLanguage((target && target.value) || (instruction && instruction.value) || '');
    if (detected) return detected;
    var browserLanguage = text(navigator.language || document.documentElement.lang || 'ko-KR');
    if (/^[a-z]{2,3}(-[A-Z]{2})?$/.test(browserLanguage)) return browserLanguage;
    return browserLanguage.toLowerCase().indexOf('ko') === 0 ? 'ko-KR' : 'en-US';
  }

  function activeTarget() {
    var select = $('policyVoiceTarget');
    var id = select && select.value ? select.value : lastFocusedTarget;
    var element = $(id);
    if (!element || element.disabled || element.closest('.hidden')) {
      id = 'policyInstruction';
      element = $(id);
      if (select) select.value = id;
    }
    return element;
  }

  function appendTranscript(element, transcript) {
    if (!element || !transcript) return;
    var current = element.value || '';
    var start = typeof element.selectionStart === 'number' ? element.selectionStart : current.length;
    var end = typeof element.selectionEnd === 'number' ? element.selectionEnd : current.length;
    var before = current.slice(0, start);
    var after = current.slice(end);
    var separator = before && !/[\s\n]$/.test(before) ? ' ' : '';
    var trailing = after && !/^[\s\n]/.test(after) ? ' ' : '';
    var insertion = separator + transcript.trim() + trailing;
    element.value = before + insertion + after;
    var caret = before.length + insertion.length;
    element.focus();
    if (typeof element.setSelectionRange === 'function') element.setSelectionRange(caret, caret);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function stopSpeech() {
    try { window.speechSynthesis.cancel(); } catch (_error) {}
  }

  function stopRecognition(message) {
    shouldRestart = false;
    clearTimeout(restartTimer);
    restartTimer = null;
    if (recognition) {
      try { recognition.onend = null; recognition.stop(); } catch (_error) {}
      try { recognition.abort(); } catch (_error) {}
    }
    recognition = null;
    activeMode = null;
    askSubmitted = false;
    if (message !== false) state('마이크 대기', message || '음성 입력을 중지했습니다.');
    updateButtons();
  }

  function stop() {
    stopRecognition();
    stopSpeech();
  }

  function errorMessage(code) {
    var messages = {
      'not-allowed': '마이크 권한이 차단되었습니다. 브라우저 주소창의 마이크 권한을 허용해 주세요.',
      'service-not-allowed': '브라우저 음성 인식 서비스 사용이 차단되었습니다.',
      'audio-capture': '사용 가능한 마이크를 찾지 못했습니다.',
      'network': '음성 인식 네트워크 연결을 확인해 주세요.',
      'no-speech': '음성이 감지되지 않았습니다. 다시 시작해 주세요.',
      'aborted': '음성 입력이 중지되었습니다.',
      'language-not-supported': '선택한 음성 언어를 지원하지 않습니다.'
    };
    return messages[code] || ('음성 인식 오류: ' + code);
  }

  function restartDictation() {
    if (!shouldRestart || activeMode !== 'dictate' || busy) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(function () {
      if (!shouldRestart || activeMode !== 'dictate' || busy) return;
      startRecognition('dictate', true);
    }, 450);
  }

  function handleAskTranscript(transcript) {
    if (askSubmitted || !transcript) return;
    askSubmitted = true;
    shouldRestart = false;
    var executionCommand = /^(?:실행(?:해|하세요)?|적용(?:해|하세요)?|execute|apply)[\s.!?]*$/i.test(transcript.trim());
    if (executionCommand && window.IGDCPolicyDiscussion && typeof window.IGDCPolicyDiscussion.applyExecutionPlan === 'function') {
      state('관리 실행 확인', '저장된 AI 실행안을 관리자 확인 단계로 엽니다.');
      if (recognition) { try { recognition.stop(); } catch (_error) {} }
      setTimeout(function () { Promise.resolve(window.IGDCPolicyDiscussion.applyExecutionPlan()).then(function (ok) { if (!ok) state('실행 보류', '실행안 또는 관리자 확인 상태를 확인해 주세요.'); }); }, 120);
      return;
    }
    var instruction = $('policyInstruction');
    appendTranscript(instruction, transcript);
    if ($('policyVoiceTarget')) $('policyVoiceTarget').value = 'policyInstruction';
    state('음성 질문 확인', '인식한 질문을 AI 정책 검토에 전달합니다.');
    if (recognition) {
      try { recognition.stop(); } catch (_error) {}
    }
    setTimeout(function () {
      if (window.IGDCPolicyDiscussion && typeof window.IGDCPolicyDiscussion.discuss === 'function') {
        Promise.resolve(window.IGDCPolicyDiscussion.discuss()).then(function (ok) {
          if (!ok) state('AI 검토 실패', '입력된 질문을 확인한 뒤 다시 실행해 주세요.');
        });
      } else {
        var button = $('policyDiscussBtn');
        if (button) button.click();
      }
    }, 120);
  }

  function createRecognition(mode) {
    var instance = new SpeechRecognitionConstructor();
    instance.lang = selectedLanguage();
    instance.continuous = mode === 'dictate';
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onstart = function () {
      state(mode === 'ask' ? '음성 질문 대기' : '음성 입력 중', mode === 'ask' ? '질문을 말씀하시면 문장 확정 후 AI가 검토합니다.' : '말씀하신 내용을 선택한 입력창에 계속 기록합니다.');
      updateButtons();
    };

    instance.onspeechstart = function () {
      state('음성 인식 중', '말씀을 듣고 있습니다.');
    };

    instance.onresult = function (event) {
      var interim = '';
      var finals = [];
      for (var index = event.resultIndex; index < event.results.length; index += 1) {
        var result = event.results[index];
        var transcript = result && result[0] && result[0].transcript ? result[0].transcript.trim() : '';
        if (!transcript) continue;
        if (result.isFinal) finals.push(transcript);
        else interim += (interim ? ' ' : '') + transcript;
      }
      if (interim) state('음성 인식 중', interim);
      if (!finals.length) return;
      var finalized = finals.join(' ').trim();
      if (mode === 'ask') {
        handleAskTranscript(finalized);
        return;
      }
      appendTranscript(activeTarget(), finalized);
      state('음성 입력 중', '기록됨: ' + finalized);
    };

    instance.onerror = function (event) {
      var code = event && event.error || 'unknown';
      var fatal = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].indexOf(code) >= 0;
      if (fatal || mode === 'ask') shouldRestart = false;
      state(fatal ? '마이크 사용 불가' : '음성 인식 확인', errorMessage(code));
    };

    instance.onend = function () {
      recognition = null;
      if (mode === 'dictate' && shouldRestart && !busy) {
        state('음성 입력 재연결', '브라우저 음성 인식을 다시 연결하는 중입니다.');
        restartDictation();
        return;
      }
      if (mode === 'ask' && !askSubmitted) {
        activeMode = null;
        state('음성 질문 종료', '확정된 문장이 없습니다. 다시 시도해 주세요.');
      } else if (mode !== 'ask') {
        activeMode = null;
        state('마이크 대기', '음성 입력이 종료되었습니다.');
      }
      updateButtons();
    };

    return instance;
  }

  function startRecognition(mode, restarting) {
    if (!SpeechRecognitionConstructor) {
      state('음성 인식 미지원', 'Chrome 또는 Edge의 최신 버전에서 마이크 기능을 사용할 수 있습니다.');
      return;
    }
    if (busy) {
      state('AI 처리 중', '현재 AI 응답이 끝난 뒤 음성 입력을 시작해 주세요.');
      return;
    }
    if (!restarting) {
      stopRecognition(false);
      stopSpeech();
      askSubmitted = false;
      activeMode = mode;
      shouldRestart = mode === 'dictate';
    }
    recognition = createRecognition(mode);
    try {
      recognition.start();
    } catch (error) {
      recognition = null;
      activeMode = null;
      shouldRestart = false;
      state('마이크 시작 실패', text(error && error.message) || '잠시 후 다시 시도해 주세요.');
      updateButtons();
    }
  }

  function toggleDictation() {
    if (activeMode === 'dictate') {
      stopRecognition('음성 입력을 중지했습니다.');
      return;
    }
    startRecognition('dictate', false);
  }

  function askByVoice() {
    startRecognition('ask', false);
  }

  function latestAssistantText() {
    if (lastSpeakText) return lastSpeakText;
    var proposal = $('policyProposal');
    if (proposal) {
      try {
        var parsed = JSON.parse(proposal.textContent || '{}');
        if (parsed && parsed.summary) return text(parsed.summary);
      } catch (_error) {}
    }
    var messages = document.querySelectorAll('#policyTranscript .policy-message.assistant');
    if (messages.length) return text(messages[messages.length - 1].textContent.replace(/^AI\s*/, ''));
    return '';
  }

  function chooseVoice(language) {
    var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    var normalized = language.toLowerCase();
    var prefix = normalized.split('-')[0];
    return voices.find(function (voice) { return text(voice.lang).toLowerCase() === normalized; }) ||
      voices.find(function (voice) { return text(voice.lang).toLowerCase().split('-')[0] === prefix; }) ||
      null;
  }

  function speak() {
    if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
      state('음성 읽기 미지원', '현재 브라우저에서 음성 읽기를 지원하지 않습니다.');
      return;
    }
    var content = latestAssistantText();
    if (!content) {
      state('읽을 AI 답변 없음', '먼저 AI와 정책을 검토해 주세요.');
      return;
    }
    stopRecognition(false);
    stopSpeech();
    var language = lastSpeakLanguage || detectTextLanguage(content) || selectedLanguage();
    var utterance = new SpeechSynthesisUtterance(content.slice(0, 3500));
    utterance.lang = language;
    utterance.rate = 1;
    utterance.pitch = 1;
    var voice = chooseVoice(language);
    if (voice) utterance.voice = voice;
    utterance.onstart = function () { state('AI 답변 읽는 중', content.slice(0, 180)); };
    utterance.onend = function () { state('마이크 대기', 'AI 답변 읽기를 마쳤습니다.'); };
    utterance.onerror = function () { state('음성 읽기 실패', '브라우저 음성 출력을 다시 시도해 주세요.'); };
    try { window.speechSynthesis.speak(utterance); } catch (_error) {
      state('음성 읽기 실패', '브라우저 음성 출력을 시작하지 못했습니다.');
    }
  }

  function clearActiveTarget() {
    stopRecognition(false);
    var target = activeTarget();
    if (!target) return;
    target.value = '';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.focus();
    state('입력 내용 삭제', '선택한 입력창을 비웠습니다. 다시 입력하거나 녹음할 수 있습니다.');
  }

  function redoDictation() {
    var target = activeTarget();
    if (!target) return;
    target.value = '';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.focus();
    state('다시 녹음 준비', '기존 입력을 지우고 새 음성 입력을 시작합니다.');
    startRecognition('dictate', false);
  }

  function updateButtons() {
    var supported = !!SpeechRecognitionConstructor;
    var dictateButton = $('policyVoiceDictateBtn');
    var askButton = $('policyVoiceAskBtn');
    var speakButton = $('policyVoiceSpeakBtn');
    var stopButton = $('policyVoiceStopBtn');
    var clearButton = $('policyVoiceClearBtn');
    var redoButton = $('policyVoiceRedoBtn');
    if (dictateButton) {
      dictateButton.disabled = busy || !supported;
      dictateButton.textContent = activeMode === 'dictate' ? '음성 입력 종료' : '음성 입력';
    }
    if (askButton) {
      askButton.disabled = busy || !supported;
      askButton.textContent = activeMode === 'ask' ? '질문 듣는 중' : '음성 질문·AI 검토';
    }
    if (speakButton) speakButton.disabled = busy;
    if (stopButton) stopButton.disabled = !activeMode && !(window.speechSynthesis && window.speechSynthesis.speaking);
    if (clearButton) clearButton.disabled = busy;
    if (redoButton) redoButton.disabled = busy || !supported;
  }

  function rememberTarget(event) {
    var element = event.target;
    if (!element || TARGET_IDS.indexOf(element.id) < 0) return;
    lastFocusedTarget = element.id;
    var select = $('policyVoiceTarget');
    if (select) select.value = element.id;
  }

  function wire() {
    if (!$('policyVoiceDictateBtn')) return;
    $('policyVoiceDictateBtn').addEventListener('click', toggleDictation);
    $('policyVoiceAskBtn').addEventListener('click', askByVoice);
    $('policyVoiceSpeakBtn').addEventListener('click', speak);
    $('policyVoiceStopBtn').addEventListener('click', stop);
    if ($('policyVoiceClearBtn')) $('policyVoiceClearBtn').addEventListener('click', clearActiveTarget);
    if ($('policyVoiceRedoBtn')) $('policyVoiceRedoBtn').addEventListener('click', redoDictation);
    TARGET_IDS.forEach(function (id) {
      var element = $(id);
      if (element) element.addEventListener('focus', rememberTarget);
    });
    $('policyVoiceLanguage').addEventListener('change', function () {
      if (activeMode) stopRecognition('음성 언어가 변경되었습니다. 다시 시작해 주세요.');
    });
    window.addEventListener('igdc:policy-ai-response', function (event) {
      lastSpeakText = text(event && event.detail && event.detail.text);
      lastSpeakLanguage = text(event && event.detail && event.detail.language) || detectTextLanguage(lastSpeakText) || selectedLanguage();
      if (lastSpeakText) {
        state('AI 답변 준비', '답변 읽기 버튼으로 같은 언어의 음성 재생을 할 수 있습니다.');
        if ($('policyVoiceConversationMode') && $('policyVoiceConversationMode').checked) {
          setTimeout(function () { if (lastSpeakText) speak(); }, 320);
        }
      }
    });
    window.addEventListener('igdc:policy-busy', function (event) {
      busy = !!(event && event.detail && event.detail.busy);
      if (busy && activeMode) stopRecognition(false);
      updateButtons();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && activeMode) stopRecognition('화면이 비활성화되어 음성 입력을 중지했습니다.');
    });
    window.addEventListener('beforeunload', stop);
    if (!SpeechRecognitionConstructor) {
      state('음성 인식 미지원', 'Chrome 또는 Edge 최신 버전에서 음성 입력을 사용할 수 있습니다. 타자 입력은 그대로 사용할 수 있습니다.');
    } else {
      state('마이크 대기', '입력창을 선택하거나 입력 대상을 지정한 뒤 음성 입력을 시작하세요.');
    }
    updateButtons();
  }

  window.IGDCPolicyVoice = {
    startDictation: toggleDictation,
    ask: askByVoice,
    speak: speak,
    stop: stop,
    clearActiveTarget: clearActiveTarget,
    redo: redoDictation,
    setSpeakText: function (value, language) { lastSpeakText = text(value); lastSpeakLanguage = text(language) || detectTextLanguage(lastSpeakText); },
    get state() { return activeMode || 'off'; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
