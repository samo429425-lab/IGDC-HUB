
// MARU Voice Insight - FINAL
(function(){
  let recognition;
  try {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = false;
  } catch(e){ return; }

  recognition.onresult = (e)=>{
    const text = e.results[0][0].transcript;
    if(window.MaruAddon){
      window.MaruAddon.handleQuery(text, { source:'voice' });
    }
  };

  window.startMaruVoice = ()=>{
    recognition.start();
  };
})();
