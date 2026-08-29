/*
 * IGDC Q&A canonical storage/i18n bridge — 2026-08-29
 * Scope: Q&A only. Existing modal layout/lifecycle remains intact.
 * - 30-language modal text normalization from the page language
 * - server-side save/list + AI first response
 * - author delete capability + owner/admin delete
 * - legacy DB schema compatible (no browser-side schema assumption)
 */
(function (global, doc) {
  'use strict';
  if (global.__IGDC_QA_STORAGE_BRIDGE_V3__) return;
  global.__IGDC_QA_STORAGE_BRIDGE_V3__ = true;

  var ENDPOINT = '/.netlify/functions/qa-proxy';
  var MODAL_SELECTOR = '.igdc-qa-modal';
  var LIST_SELECTOR = '.igdc-qa-threads';
  var QUESTION_SELECTOR = '.igdc-qa-text.q';
  var ANSWER_SELECTOR = '.igdc-qa-text.a';
  var SUBMIT_SELECTOR = '.igdc-qa-btn.primary';
  var CLEAR_SELECTOR = '.igdc-qa-btn.muted';
  var CAP_STORE_KEY = 'igdc_qna_delete_caps.v1';
  var refreshTimer = null;
  var UI = {"ko":{"title":"질문하기","close":"닫기","q":"질문","qp":"질문 내용을 입력하세요.","a":"AI 1차 답변","ap":"답변을 준비하는 중입니다...","submit":"AI 답변 받기","clear":"지우기","note":"AI 상담사가 이메일 답변 형식으로 1차 안내합니다.","saving":"답변을 준비하는 중입니다...","saved":"✓","loadFail":"답변 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.","saveFail":"답변 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.","pending":"답변을 준비하는 중입니다...","admin":"ADMIN","normal":"AI","delete":"지우기","deleting":"답변을 준비하는 중입니다...","removed":"✓","deleteFail":"답변 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.","confirm":"지우기?"},"en":{"title":"Ask a question","close":"Close","q":"Question","qp":"Enter your question.","a":"AI first answer","ap":"Preparing an answer...","submit":"Get AI answer","clear":"Clear","note":"The AI consultant provides a first response in an email-style format.","saving":"Preparing an answer...","saved":"✓","loadFail":"An error occurred while processing the answer. Please try again later.","saveFail":"An error occurred while processing the answer. Please try again later.","pending":"Preparing an answer...","admin":"ADMIN","normal":"AI","delete":"Clear","deleting":"Preparing an answer...","removed":"✓","deleteFail":"An error occurred while processing the answer. Please try again later.","confirm":"Clear?"},"zh":{"title":"Q&A 咨询","close":"关闭","q":"问题","qp":"请输入问题内容。","a":"AI 初步回复","ap":"正在准备回复...","submit":"获取 AI 回复","clear":"清除","note":"一般问题请先在这里提交。AI 顾问会以邮件式回复进行初步 안내，重要问题会转交管理员审核。","saving":"正在准备回复...","saved":"✓","loadFail":"处理回复时发生错误，请稍后再试。","saveFail":"处理回复时发生错误，请稍后再试。","pending":"正在准备回复...","admin":"ADMIN","normal":"AI","delete":"清除","deleting":"正在准备回复...","removed":"✓","deleteFail":"处理回复时发生错误，请稍后再试。","confirm":"清除?"},"zht":{"title":"Q&A 諮詢","close":"關閉","q":"問題","qp":"請輸入問題內容。","a":"AI 初步回覆","ap":"正在準備回覆...","submit":"取得 AI 回覆","clear":"清除","note":"一般問題請先在此提交。AI 顧問會以郵件式回覆進行初步 안내，重要問題會轉交管理員審核。","saving":"正在準備回覆...","saved":"✓","loadFail":"處理回覆時發生錯誤，請稍後再試。","saveFail":"處理回覆時發生錯誤，請稍後再試。","pending":"正在準備回覆...","admin":"ADMIN","normal":"AI","delete":"清除","deleting":"正在準備回覆...","removed":"✓","deleteFail":"處理回覆時發生錯誤，請稍後再試。","confirm":"清除?"},"ja":{"title":"Q&Aで質問","close":"閉じる","q":"質問","qp":"質問内容を入力してください。","a":"AI一次回答","ap":"回答を準備しています...","submit":"AI回答を受け取る","clear":"クリア","note":"一般的な質問はまずこちらから送信してください。AI相談員がメール形式で一次回答し、重要な内容は管理者確認へ送られます。","saving":"回答を準備しています...","saved":"✓","loadFail":"回答処理中にエラーが発生しました。後でもう一度お試しください。","saveFail":"回答処理中にエラーが発生しました。後でもう一度お試しください。","pending":"回答を準備しています...","admin":"ADMIN","normal":"AI","delete":"クリア","deleting":"回答を準備しています...","removed":"✓","deleteFail":"回答処理中にエラーが発生しました。後でもう一度お試しください。","confirm":"クリア?"},"es":{"title":"Preguntar en Q&A","close":"Cerrar","q":"Pregunta","qp":"Escriba su pregunta.","a":"Primera respuesta de IA","ap":"Preparando respuesta...","submit":"Recibir respuesta IA","clear":"Limpiar","note":"Envíe primero las preguntas generales aquí. El asesor de IA responde en formato de correo y los casos importantes pasan a revisión administrativa.","saving":"Preparando respuesta...","saved":"✓","loadFail":"Ocurrió un error. Inténtelo más tarde.","saveFail":"Ocurrió un error. Inténtelo más tarde.","pending":"Preparando respuesta...","admin":"ADMIN","normal":"AI","delete":"Limpiar","deleting":"Preparando respuesta...","removed":"✓","deleteFail":"Ocurrió un error. Inténtelo más tarde.","confirm":"Limpiar?"},"fr":{"title":"Poser une question Q&A","close":"Fermer","q":"Question","qp":"Saisissez votre question.","a":"Première réponse IA","ap":"Préparation de la réponse...","submit":"Obtenir une réponse IA","clear":"Effacer","note":"Veuillez d’abord poser les questions générales ici. Le conseiller IA répond au format e-mail et les cas importants sont transmis à l’admin.","saving":"Préparation de la réponse...","saved":"✓","loadFail":"Une erreur est survenue. Réessayez plus tard.","saveFail":"Une erreur est survenue. Réessayez plus tard.","pending":"Préparation de la réponse...","admin":"ADMIN","normal":"AI","delete":"Effacer","deleting":"Préparation de la réponse...","removed":"✓","deleteFail":"Une erreur est survenue. Réessayez plus tard.","confirm":"Effacer?"},"de":{"title":"Q&A fragen","close":"Schließen","q":"Frage","qp":"Geben Sie Ihre Frage ein.","a":"KI-Erstantwort","ap":"Antwort wird vorbereitet...","submit":"KI-Antwort erhalten","clear":"Löschen","note":"Bitte stellen Sie allgemeine Fragen zuerst hier. Der KI-Berater antwortet im E-Mail-Stil; wichtige Fälle gehen an die Admin-Prüfung.","saving":"Antwort wird vorbereitet...","saved":"✓","loadFail":"Beim Verarbeiten trat ein Fehler auf. Bitte später erneut versuchen.","saveFail":"Beim Verarbeiten trat ein Fehler auf. Bitte später erneut versuchen.","pending":"Antwort wird vorbereitet...","admin":"ADMIN","normal":"AI","delete":"Löschen","deleting":"Antwort wird vorbereitet...","removed":"✓","deleteFail":"Beim Verarbeiten trat ein Fehler auf. Bitte später erneut versuchen.","confirm":"Löschen?"},"ru":{"title":"Задать вопрос Q&A","close":"Закрыть","q":"Вопрос","qp":"Введите вопрос.","a":"Первичный ответ ИИ","ap":"Подготовка ответа...","submit":"Получить ответ ИИ","clear":"Очистить","note":"Общие вопросы сначала отправляйте здесь. ИИ-консультант даст ответ в формате письма, важные вопросы передаются администратору.","saving":"Подготовка ответа...","saved":"✓","loadFail":"Ошибка обработки. Повторите позже.","saveFail":"Ошибка обработки. Повторите позже.","pending":"Подготовка ответа...","admin":"ADMIN","normal":"AI","delete":"Очистить","deleting":"Подготовка ответа...","removed":"✓","deleteFail":"Ошибка обработки. Повторите позже.","confirm":"Очистить?"},"pt":{"title":"Perguntar no Q&A","close":"Fechar","q":"Pergunta","qp":"Digite sua pergunta.","a":"Primeira resposta da IA","ap":"Preparando resposta...","submit":"Obter resposta da IA","clear":"Limpar","note":"Envie perguntas gerais aqui primeiro. O consultor de IA responde em formato de e-mail e casos importantes seguem para revisão administrativa.","saving":"Preparando resposta...","saved":"✓","loadFail":"Ocorreu um erro. Tente novamente mais tarde.","saveFail":"Ocorreu um erro. Tente novamente mais tarde.","pending":"Preparando resposta...","admin":"ADMIN","normal":"AI","delete":"Limpar","deleting":"Preparando resposta...","removed":"✓","deleteFail":"Ocorreu um erro. Tente novamente mais tarde.","confirm":"Limpar?"},"it":{"title":"Fai una domanda Q&A","close":"Chiudi","q":"Domanda","qp":"Inserisci la domanda.","a":"Prima risposta IA","ap":"Preparazione risposta...","submit":"Ricevi risposta IA","clear":"Cancella","note":"Invia prima qui le domande generali. Il consulente IA risponde in formato e-mail e i casi importanti vanno all’admin.","saving":"Preparazione risposta...","saved":"✓","loadFail":"Errore durante l’elaborazione. Riprova più tardi.","saveFail":"Errore durante l’elaborazione. Riprova più tardi.","pending":"Preparazione risposta...","admin":"ADMIN","normal":"AI","delete":"Cancella","deleting":"Preparazione risposta...","removed":"✓","deleteFail":"Errore durante l’elaborazione. Riprova più tardi.","confirm":"Cancella?"},"ar":{"title":"اسأل عبر Q&A","close":"إغلاق","q":"سؤال","qp":"اكتب سؤالك.","a":"الرد الأولي من AI","ap":"جارٍ إعداد الرد...","submit":"الحصول على رد AI","clear":"مسح","note":"يرجى إرسال الأسئلة العامة هنا أولاً. يجيب مستشار الذكاء الاصطناعي بصيغة بريدية، وتُحال الحالات المهمة للمسؤول.","saving":"جارٍ إعداد الرد...","saved":"✓","loadFail":"حدث خطأ. حاول لاحقاً.","saveFail":"حدث خطأ. حاول لاحقاً.","pending":"جارٍ إعداد الرد...","admin":"ADMIN","normal":"AI","delete":"مسح","deleting":"جارٍ إعداد الرد...","removed":"✓","deleteFail":"حدث خطأ. حاول لاحقاً.","confirm":"مسح?"},"vi":{"title":"Hỏi Q&A","close":"Đóng","q":"Câu hỏi","qp":"Nhập câu hỏi của bạn.","a":"Trả lời AI bước đầu","ap":"Đang chuẩn bị trả lời...","submit":"Nhận trả lời AI","clear":"Xóa","note":"Vui lòng gửi câu hỏi chung tại đây trước. Tư vấn AI trả lời theo dạng email; vấn đề quan trọng sẽ chuyển cho quản trị viên.","saving":"Đang chuẩn bị trả lời...","saved":"✓","loadFail":"Có lỗi xảy ra. Vui lòng thử lại sau.","saveFail":"Có lỗi xảy ra. Vui lòng thử lại sau.","pending":"Đang chuẩn bị trả lời...","admin":"ADMIN","normal":"AI","delete":"Xóa","deleting":"Đang chuẩn bị trả lời...","removed":"✓","deleteFail":"Có lỗi xảy ra. Vui lòng thử lại sau.","confirm":"Xóa?"},"th":{"title":"ถามผ่าน Q&A","close":"ปิด","q":"คำถาม","qp":"กรอกคำถามของคุณ","a":"คำตอบเบื้องต้นจาก AI","ap":"กำลังเตรียมคำตอบ...","submit":"รับคำตอบจาก AI","clear":"ล้าง","note":"โปรดส่งคำถามทั่วไปที่นี่ก่อน ที่ปรึกษา AI จะตอบในรูปแบบอีเมล และเรื่องสำคัญจะส่งให้ผู้ดูแลตรวจสอบ","saving":"กำลังเตรียมคำตอบ...","saved":"✓","loadFail":"เกิดข้อผิดพลาด โปรดลองใหม่ภายหลัง","saveFail":"เกิดข้อผิดพลาด โปรดลองใหม่ภายหลัง","pending":"กำลังเตรียมคำตอบ...","admin":"ADMIN","normal":"AI","delete":"ล้าง","deleting":"กำลังเตรียมคำตอบ...","removed":"✓","deleteFail":"เกิดข้อผิดพลาด โปรดลองใหม่ภายหลัง","confirm":"ล้าง?"},"id":{"title":"Tanya Q&A","close":"Tutup","q":"Pertanyaan","qp":"Masukkan pertanyaan Anda.","a":"Jawaban awal AI","ap":"Menyiapkan jawaban...","submit":"Dapatkan jawaban AI","clear":"Hapus","note":"Ajukan pertanyaan umum di sini terlebih dahulu. Konsultan AI menjawab dalam format email, dan kasus penting dikirim ke admin.","saving":"Menyiapkan jawaban...","saved":"✓","loadFail":"Terjadi kesalahan. Coba lagi nanti.","saveFail":"Terjadi kesalahan. Coba lagi nanti.","pending":"Menyiapkan jawaban...","admin":"ADMIN","normal":"AI","delete":"Hapus","deleting":"Menyiapkan jawaban...","removed":"✓","deleteFail":"Terjadi kesalahan. Coba lagi nanti.","confirm":"Hapus?"},"hi":{"title":"Q&A में पूछें","close":"बंद करें","q":"प्रश्न","qp":"अपना प्रश्न लिखें।","a":"AI प्रारंभिक उत्तर","ap":"उत्तर तैयार हो रहा है...","submit":"AI उत्तर प्राप्त करें","clear":"साफ़ करें","note":"सामान्य प्रश्न पहले यहाँ भेजें। AI सलाहकार ईमेल शैली में पहला उत्तर देगा और महत्वपूर्ण मामले व्यवस्थापक को भेजे जाएंगे।","saving":"उत्तर तैयार हो रहा है...","saved":"✓","loadFail":"उत्तर प्रक्रिया में त्रुटि हुई। बाद में प्रयास करें।","saveFail":"उत्तर प्रक्रिया में त्रुटि हुई। बाद में प्रयास करें।","pending":"उत्तर तैयार हो रहा है...","admin":"ADMIN","normal":"AI","delete":"साफ़ करें","deleting":"उत्तर तैयार हो रहा है...","removed":"✓","deleteFail":"उत्तर प्रक्रिया में त्रुटि हुई। बाद में प्रयास करें।","confirm":"साफ़ करें?"},"tr":{"title":"Q&A sor","close":"Kapat","q":"Soru","qp":"Sorunuzu yazın.","a":"AI ilk yanıt","ap":"Yanıt hazırlanıyor...","submit":"AI yanıtı al","clear":"Temizle","note":"Genel soruları önce buradan gönderin. AI danışmanı e-posta biçiminde ilk yanıtı verir; önemli konular admine yönlendirilir.","saving":"Yanıt hazırlanıyor...","saved":"✓","loadFail":"Bir hata oluştu. Lütfen sonra tekrar deneyin.","saveFail":"Bir hata oluştu. Lütfen sonra tekrar deneyin.","pending":"Yanıt hazırlanıyor...","admin":"ADMIN","normal":"AI","delete":"Temizle","deleting":"Yanıt hazırlanıyor...","removed":"✓","deleteFail":"Bir hata oluştu. Lütfen sonra tekrar deneyin.","confirm":"Temizle?"},"fa":{"title":"پرسش در Q&A","close":"بستن","q":"سؤال","qp":"پرسش خود را وارد کنید.","a":"پاسخ اولیه AI","ap":"در حال آماده‌سازی پاسخ...","submit":"دریافت پاسخ AI","clear":"پاک کردن","note":"لطفاً پرسش‌های عمومی را ابتدا اینجا بفرستید. مشاور AI پاسخ اولیه را به شکل ایمیل می‌دهد و موارد مهم به مدیر ارجاع می‌شود.","saving":"در حال آماده‌سازی پاسخ...","saved":"✓","loadFail":"خطا رخ داد. بعداً دوباره تلاش کنید.","saveFail":"خطا رخ داد. بعداً دوباره تلاش کنید.","pending":"در حال آماده‌سازی پاسخ...","admin":"ADMIN","normal":"AI","delete":"پاک کردن","deleting":"در حال آماده‌سازی پاسخ...","removed":"✓","deleteFail":"خطا رخ داد. بعداً دوباره تلاش کنید.","confirm":"پاک کردن?"},"bn":{"title":"Q&A প্রশ্ন","close":"বন্ধ করুন","q":"প্রশ্ন","qp":"আপনার প্রশ্ন লিখুন।","a":"AI প্রাথমিক উত্তর","ap":"উত্তর প্রস্তুত হচ্ছে...","submit":"AI উত্তর নিন","clear":"মুছুন","note":"সাধারণ প্রশ্ন আগে এখানে পাঠান। AI পরামর্শদাতা ইমেইল-শৈলীতে প্রথম উত্তর দেবেন; গুরুত্বপূর্ণ বিষয় অ্যাডমিনে যাবে।","saving":"উত্তর প্রস্তুত হচ্ছে...","saved":"✓","loadFail":"ত্রুটি হয়েছে। পরে আবার চেষ্টা করুন।","saveFail":"ত্রুটি হয়েছে। পরে আবার চেষ্টা করুন।","pending":"উত্তর প্রস্তুত হচ্ছে...","admin":"ADMIN","normal":"AI","delete":"মুছুন","deleting":"উত্তর প্রস্তুত হচ্ছে...","removed":"✓","deleteFail":"ত্রুটি হয়েছে। পরে আবার চেষ্টা করুন।","confirm":"মুছুন?"},"ur":{"title":"Q&A میں سوال","close":"بند کریں","q":"سوال","qp":"اپنا سوال درج کریں۔","a":"AI ابتدائی جواب","ap":"جواب تیار ہو رہا ہے...","submit":"AI جواب حاصل کریں","clear":"صاف کریں","note":"عام سوالات پہلے یہاں بھیجیں۔ AI مشیر ای میل طرز میں ابتدائی جواب دے گا، اہم سوالات ایڈمن کو جائیں گے۔","saving":"جواب تیار ہو رہا ہے...","saved":"✓","loadFail":"خرابی ہوئی۔ بعد میں دوبارہ کوشش کریں۔","saveFail":"خرابی ہوئی۔ بعد میں دوبارہ کوشش کریں۔","pending":"جواب تیار ہو رہا ہے...","admin":"ADMIN","normal":"AI","delete":"صاف کریں","deleting":"جواب تیار ہو رہا ہے...","removed":"✓","deleteFail":"خرابی ہوئی۔ بعد میں دوبارہ کوشش کریں۔","confirm":"صاف کریں?"},"sw":{"title":"Uliza Q&A","close":"Funga","q":"Swali","qp":"Andika swali lako.","a":"Jibu la kwanza la AI","ap":"Kuandaa jibu...","submit":"Pata jibu la AI","clear":"Futa","note":"Tuma maswali ya kawaida hapa kwanza. Mshauri wa AI atajibu kwa mtindo wa barua pepe; masuala muhimu yataenda kwa msimamizi.","saving":"Kuandaa jibu...","saved":"✓","loadFail":"Hitilafu imetokea. Jaribu tena baadaye.","saveFail":"Hitilafu imetokea. Jaribu tena baadaye.","pending":"Kuandaa jibu...","admin":"ADMIN","normal":"AI","delete":"Futa","deleting":"Kuandaa jibu...","removed":"✓","deleteFail":"Hitilafu imetokea. Jaribu tena baadaye.","confirm":"Futa?"},"ta":{"title":"Q&A கேள்வி","close":"மூடு","q":"கேள்வி","qp":"உங்கள் கேள்வியை உள்ளிடவும்.","a":"AI முதற்கட்ட பதில்","ap":"பதில் தயாராகிறது...","submit":"AI பதில் பெறுக","clear":"அழி","note":"பொதுக் கேள்விகளை முதலில் இங்கே அனுப்பவும். AI ஆலோசகர் மின்னஞ்சல் வடிவில் முதற்கட்ட பதில் அளிப்பார்; முக்கியமானவை நிர்வாகிக்கு அனுப்பப்படும்.","saving":"பதில் தயாராகிறது...","saved":"✓","loadFail":"பிழை ஏற்பட்டது. பின்னர் முயற்சிக்கவும்.","saveFail":"பிழை ஏற்பட்டது. பின்னர் முயற்சிக்கவும்.","pending":"பதில் தயாராகிறது...","admin":"ADMIN","normal":"AI","delete":"அழி","deleting":"பதில் தயாராகிறது...","removed":"✓","deleteFail":"பிழை ஏற்பட்டது. பின்னர் முயற்சிக்கவும்.","confirm":"அழி?"},"hu":{"title":"Q&A kérdés","close":"Bezárás","q":"Kérdés","qp":"Írja be a kérdését.","a":"AI első válasz","ap":"Válasz előkészítése...","submit":"AI válasz kérése","clear":"Törlés","note":"Az általános kérdéseket először itt küldje el. Az AI tanácsadó e-mail formában válaszol, a fontos ügyek adminhoz kerülnek.","saving":"Válasz előkészítése...","saved":"✓","loadFail":"Hiba történt. Próbálja később.","saveFail":"Hiba történt. Próbálja később.","pending":"Válasz előkészítése...","admin":"ADMIN","normal":"AI","delete":"Törlés","deleting":"Válasz előkészítése...","removed":"✓","deleteFail":"Hiba történt. Próbálja később.","confirm":"Törlés?"},"ms":{"title":"Tanya Q&A","close":"Tutup","q":"Soalan","qp":"Masukkan soalan anda.","a":"Jawapan awal AI","ap":"Menyediakan jawapan...","submit":"Dapatkan jawapan AI","clear":"Kosongkan","note":"Hantar soalan umum di sini dahulu. Penasihat AI menjawab dalam format e-mel; perkara penting dihantar kepada admin.","saving":"Menyediakan jawapan...","saved":"✓","loadFail":"Ralat berlaku. Cuba lagi kemudian.","saveFail":"Ralat berlaku. Cuba lagi kemudian.","pending":"Menyediakan jawapan...","admin":"ADMIN","normal":"AI","delete":"Kosongkan","deleting":"Menyediakan jawapan...","removed":"✓","deleteFail":"Ralat berlaku. Cuba lagi kemudian.","confirm":"Kosongkan?"},"nl":{"title":"Vraag via Q&A","close":"Sluiten","q":"Vraag","qp":"Voer uw vraag in.","a":"Eerste AI-antwoord","ap":"Antwoord voorbereiden...","submit":"Ontvang AI-antwoord","clear":"Wissen","note":"Stel algemene vragen eerst hier. De AI-adviseur antwoordt in e-mailvorm; belangrijke zaken gaan naar adminreview.","saving":"Antwoord voorbereiden...","saved":"✓","loadFail":"Er is een fout opgetreden. Probeer later opnieuw.","saveFail":"Er is een fout opgetreden. Probeer later opnieuw.","pending":"Antwoord voorbereiden...","admin":"ADMIN","normal":"AI","delete":"Wissen","deleting":"Antwoord voorbereiden...","removed":"✓","deleteFail":"Er is een fout opgetreden. Probeer later opnieuw.","confirm":"Wissen?"},"pl":{"title":"Zapytaj Q&A","close":"Zamknij","q":"Pytanie","qp":"Wpisz pytanie.","a":"Pierwsza odpowiedź AI","ap":"Przygotowywanie odpowiedzi...","submit":"Uzyskaj odpowiedź AI","clear":"Wyczyść","note":"Pytania ogólne najpierw wyślij tutaj. Konsultant AI odpowie w formie e-maila, a ważne sprawy trafią do admina.","saving":"Przygotowywanie odpowiedzi...","saved":"✓","loadFail":"Wystąpił błąd. Spróbuj później.","saveFail":"Wystąpił błąd. Spróbuj później.","pending":"Przygotowywanie odpowiedzi...","admin":"ADMIN","normal":"AI","delete":"Wyczyść","deleting":"Przygotowywanie odpowiedzi...","removed":"✓","deleteFail":"Wystąpił błąd. Spróbuj później.","confirm":"Wyczyść?"},"sv":{"title":"Fråga Q&A","close":"Stäng","q":"Fråga","qp":"Ange din fråga.","a":"Första AI-svar","ap":"Förbereder svar...","submit":"Få AI-svar","clear":"Rensa","note":"Skicka allmänna frågor här först. AI-rådgivaren svarar i e-postformat; viktiga ärenden går till admin.","saving":"Förbereder svar...","saved":"✓","loadFail":"Ett fel uppstod. Försök senare.","saveFail":"Ett fel uppstod. Försök senare.","pending":"Förbereder svar...","admin":"ADMIN","normal":"AI","delete":"Rensa","deleting":"Förbereder svar...","removed":"✓","deleteFail":"Ett fel uppstod. Försök senare.","confirm":"Rensa?"},"tl":{"title":"Magtanong sa Q&A","close":"Isara","q":"Tanong","qp":"Ilagay ang iyong tanong.","a":"Unang sagot ng AI","ap":"Inihahanda ang sagot...","submit":"Kumuha ng sagot ng AI","clear":"I-clear","note":"Ipadala muna dito ang pangkalahatang tanong. Sasagot ang AI consultant sa anyong email; ipapasa sa admin ang mahahalagang kaso.","saving":"Inihahanda ang sagot...","saved":"✓","loadFail":"Nagkaroon ng error. Subukan muli mamaya.","saveFail":"Nagkaroon ng error. Subukan muli mamaya.","pending":"Inihahanda ang sagot...","admin":"ADMIN","normal":"AI","delete":"I-clear","deleting":"Inihahanda ang sagot...","removed":"✓","deleteFail":"Nagkaroon ng error. Subukan muli mamaya.","confirm":"I-clear?"},"uk":{"title":"Запитати Q&A","close":"Закрити","q":"Питання","qp":"Введіть питання.","a":"Перша відповідь AI","ap":"Підготовка відповіді...","submit":"Отримати відповідь AI","clear":"Очистити","note":"Загальні питання спочатку надсилайте тут. AI-консультант відповість у форматі листа; важливі справи підуть адміністратору.","saving":"Підготовка відповіді...","saved":"✓","loadFail":"Сталася помилка. Спробуйте пізніше.","saveFail":"Сталася помилка. Спробуйте пізніше.","pending":"Підготовка відповіді...","admin":"ADMIN","normal":"AI","delete":"Очистити","deleting":"Підготовка відповіді...","removed":"✓","deleteFail":"Сталася помилка. Спробуйте пізніше.","confirm":"Очистити?"},"uz":{"title":"Q&A orqali so‘rash","close":"Yopish","q":"Savol","qp":"Savolingizni kiriting.","a":"AI birinchi javobi","ap":"Javob tayyorlanmoqda...","submit":"AI javobini olish","clear":"Tozalash","note":"Umumiy savollarni avval shu yerga yuboring. AI maslahatchi email uslubida javob beradi; muhim masalalar adminga yuboriladi.","saving":"Javob tayyorlanmoqda...","saved":"✓","loadFail":"Xatolik yuz berdi. Keyinroq urinib ko‘ring.","saveFail":"Xatolik yuz berdi. Keyinroq urinib ko‘ring.","pending":"Javob tayyorlanmoqda...","admin":"ADMIN","normal":"AI","delete":"Tozalash","deleting":"Javob tayyorlanmoqda...","removed":"✓","deleteFail":"Xatolik yuz berdi. Keyinroq urinib ko‘ring.","confirm":"Tozalash?"}};

  var EMPTY_TEXT = {
    ko:'아직 등록된 Q&A가 없습니다.',
    en:'No Q&A entries have been registered yet.',
    zh:'暂时还没有已登记的问答。',
    zht:'目前尚無已登記的問答。',
    ja:'質問と回答の投稿はまだありません。',
    es:'Aún no hay entradas de preguntas y respuestas registradas.',
    fr:'Il n’y a pas encore de contenu Q&R.',
    de:'Es wurden noch keine Q&A-Einträge registriert.',
    ru:'Записи Вопросы и ответы пока не зарегистрированы.',
    pt:'Ainda não há entradas de P&R registradas.',
    it:'Non sono ancora stati pubblicati elementi di domande e risposte.',
    ar:'لا توجد أسئلة وأجوبة مسجلة حتى الآن.',
    vi:'Chưa có mục Hỏi & Đáp nào được đăng ký.',
    th:'ยังไม่มีรายการ Q&A ที่ลงทะเบียนไว้',
    id:'Belum ada konten Tanya Jawab.',
    hi:'अभी तक कोई प्रश्नोत्तर प्रविष्टि दर्ज नहीं हुई है।',
    tr:'Henüz kayıtlı bir Soru-Cevap girdisi yok.',
    fa:'هنوز هیچ مورد پرسش و پاسخی ثبت نشده است.',
    bn:'এখনও কোনো প্রশ্নোত্তর নিবন্ধিত হয়নি।',
    ur:'ابھی تک کوئی سوال و جواب درج نہیں ہوا۔',
    sw:'Hakuna maswali na majibu yaliyosajiliwa bado.',
    ta:'இன்னும் எந்த கேள்வி-பதில் பதிவுகளும் இல்லை.',
    hu:'Még nincs közzétett kérdés-válasz bejegyzés.',
    ms:'Belum ada entri soal jawab yang disiarkan.',
    nl:'Er zijn nog geen berichten met vragen en antwoorden geplaatst.',
    pl:'Nie zarejestrowano jeszcze żadnych wpisów Pytania i odpowiedzi.',
    sv:'Inga Frågor och svar-poster har registrerats ännu.',
    tl:'Wala pang nairehistrong Q&A entry.',
    uk:'Ще немає зареєстрованих запитань і відповідей.',
    uz:'Hozircha ro‘yxatdan o‘tgan savol-javoblar yo‘q.'
  };


  function text(value) { return value == null ? '' : String(value); }
  function clean(value, limit) {
    return text(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, limit || 2000);
  }
  function langCode() {
    var html = doc.documentElement || {};
    var raw = clean(html.lang || global.IGTC_CURRENT_LANG || global.navigator && global.navigator.language || 'ko', 24).toLowerCase();
    if (raw.indexOf('zh-hant') === 0 || raw.indexOf('zh-tw') === 0 || raw.indexOf('zh-hk') === 0) return 'zht';
    var base = raw.split(/[-_]/)[0] || 'ko';
    return UI[raw] ? raw : (UI[base] ? base : 'en');
  }
  function tr(kind) { var t=UI[langCode()] || UI.en; return t[kind] || UI.en[kind] || ''; }
  function sidebarTitle() {
    var node = doc.querySelector('#qnaOpenBtn,#qna열기Btn,[data-igtc-qna="1"]');
    if (!node) return '';
    return clean((node.textContent || '').replace(/^[\s\uD800-\uDBFF][\s\S]?/, '').replace(/^💬\s*/, ''), 120);
  }
  function getScope() {
    var vars = global.SUPER_VARSAR || {};
    var project = clean(vars.project || 'IGDC', 120) || 'IGDC';
    var pageId = clean(vars.pageId || vars.page_id || (global.location && (global.location.pathname + (global.location.hash || ''))), 360);
    return { project: project, page_id: pageId };
  }
  function modalFor(node) {
    if (node && node.closest) { var m=node.closest(MODAL_SELECTOR); if (m) return m; }
    return doc.querySelector(MODAL_SELECTOR);
  }
  function getList(modal) { return modal && modal.querySelector ? modal.querySelector(LIST_SELECTOR) : null; }
  function getQuestion(modal) { return modal && modal.querySelector ? modal.querySelector(QUESTION_SELECTOR) : null; }
  function getAnswer(modal) { return modal && modal.querySelector ? modal.querySelector(ANSWER_SELECTOR) : null; }
  function getSubmit(modal) { return modal && modal.querySelector ? modal.querySelector(SUBMIT_SELECTOR) : null; }

  function isMediaHubPage() {
    var path=''; try { path=(global.location&&global.location.pathname)||''; } catch(e) {}
    return /(?:^|\/)mediahub(?:_|\.|\/|$)/i.test(path);
  }
  function ensureEmptyI18nStyle() {
    if(doc.getElementById('igdcQnaEmptyI18nStyle')) return;
    var style=doc.createElement('style');
    style.id='igdcQnaEmptyI18nStyle';
    style.textContent='.igdc-qa-threads[data-igdc-qna-empty]:empty::before{content:attr(data-igdc-qna-empty)!important;}';
    (doc.head||doc.documentElement).appendChild(style);
  }
  function localizeModal(modal) {
    if (!modal || !modal.querySelector) return;
    var emptyList=getList(modal);
    if(emptyList && !isMediaHubPage()) { ensureEmptyI18nStyle(); emptyList.setAttribute('data-igdc-qna-empty', EMPTY_TEXT[langCode()] || EMPTY_TEXT.en); }
    var title=modal.querySelector('.igdc-qa-title'); if(title) title.textContent=sidebarTitle() || tr('title');
    var close=modal.querySelector('.igdc-qa-close'); if(close) close.setAttribute('aria-label',tr('close'));
    var q=getQuestion(modal), a=getAnswer(modal);
    if(q) { q.placeholder=tr('qp'); var ql=q.previousElementSibling; if(ql && ql.tagName==='LABEL') ql.textContent=tr('q'); }
    if(a) { a.placeholder=tr('ap'); var al=a.previousElementSibling; if(al && al.tagName==='LABEL') al.textContent=tr('a'); }
    var submit=getSubmit(modal); if(submit && !submit.disabled) submit.textContent=tr('submit');
    var clearBtn=modal.querySelector(CLEAR_SELECTOR); if(clearBtn && !clearBtn.hasAttribute('data-igdc-qna-delete')) clearBtn.textContent=tr('clear');
    var note=modal.querySelector('.igdc-qa-note'); if(note) note.textContent=tr('note');
    modal.setAttribute('data-igdc-qna-lang',langCode());
  }

  function setStatus(modal, value, isError) {
    if (!modal || !modal.querySelector) return;
    var panel=modal.querySelector('.igdc-qa-panel') || modal;
    var node=panel.querySelector('[data-igdc-qna-storage-status]');
    if(!node) {
      node=doc.createElement('div'); node.setAttribute('data-igdc-qna-storage-status','1'); node.setAttribute('role','status'); node.setAttribute('aria-live','polite');
      node.style.cssText='min-height:1.2em;margin:6px 0 0;font-size:12px;line-height:1.35;';
      var list=getList(modal); if(list && list.parentNode) list.parentNode.insertBefore(node,list); else panel.appendChild(node);
    }
    node.textContent=value || ''; node.style.opacity=value ? '1':'0'; node.style.color=isError ? '#b00020':'';
  }
  function dateText(value) { try { return new Date(value).toLocaleString(); } catch(e) { return ''; } }
  function safeJson(value) { try { return JSON.parse(value); } catch(e) { return null; } }
  function jwtValid(token) {
    try {
      var parts=text(token).split('.'); if(parts.length!==3) return false;
      var value=parts[1].replace(/-/g,'+').replace(/_/g,'/'); while(value.length%4) value+='=';
      var payload=JSON.parse(global.atob(value)); return !payload.exp || Number(payload.exp)*1000 > Date.now()+10000;
    } catch(e) { return false; }
  }
  function memberIdToken() {
    var candidates=[];
    try { if(global.IGDCMemberAuth && typeof global.IGDCMemberAuth.getIdToken==='function') candidates.push(global.IGDCMemberAuth.getIdToken()); } catch(e){}
    try { if(global.osAuth && typeof global.osAuth.getIdToken==='function') candidates.push(global.osAuth.getIdToken()); } catch(e){}
    [global.localStorage,global.sessionStorage].forEach(function(store){
      if(!store) return;
      ['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa'].forEach(function(key){
        try { var r=safeJson(store.getItem(key)); if(r) candidates.push(r.id_token,r.idToken,r.__raw,r.raw); } catch(e){}
      });
      ['igdc_id_token','id_token','auth0_id_token'].forEach(function(key){ try{candidates.push(store.getItem(key));}catch(e){} });
    });
    for(var i=0;i<candidates.length;i++) if(candidates[i] && jwtValid(candidates[i])) return text(candidates[i]);
    return '';
  }
  function storedSupabaseToken() {
    var stores=[]; try{stores.push(global.localStorage);}catch(e){} try{stores.push(global.sessionStorage);}catch(e){}
    for(var s=0;s<stores.length;s++){ var store=stores[s]; if(!store) continue;
      for(var i=0;i<store.length;i++){ var key=''; try{key=store.key(i)||'';}catch(e){continue;} if(!/^sb-.+-auth-token$/i.test(key)) continue;
        try{ var r=safeJson(store.getItem(key)); var tok=r && (r.access_token || r.currentSession&&r.currentSession.access_token || r.session&&r.session.access_token); if(tok) return text(tok); }catch(e){}
      }
    } return '';
  }
  function authHeaders(withJson) {
    var headers={Accept:'application/json'}; if(withJson) headers['Content-Type']='application/json';
    var supa=storedSupabaseToken(), member=memberIdToken();
    if(supa) headers.Authorization='Bearer '+supa; else if(member) headers.Authorization='Bearer '+member;
    if(member && member!==supa) headers['X-IGDC-Member-Token']=member;
    return headers;
  }

  function capMap() { try{return safeJson(global.localStorage.getItem(CAP_STORE_KEY)) || {};}catch(e){return {};} }
  function capKey(scope,id) { return clean(scope.project,120)+'|'+clean(scope.page_id,360)+'|'+clean(id,240); }
  function getCap(scope,id) { var m=capMap(); return clean(m[capKey(scope,id)],2000); }
  function saveCap(scope,id,token) {
    token=clean(token,2000); id=clean(id,240); if(!token || !id) return;
    try{ var m=capMap(); m[capKey(scope,id)]=token; var keys=Object.keys(m); if(keys.length>300) keys.slice(0,keys.length-300).forEach(function(k){delete m[k];}); global.localStorage.setItem(CAP_STORE_KEY,JSON.stringify(m)); }catch(e){}
  }
  function dropCap(scope,id) { try{var m=capMap(); delete m[capKey(scope,id)]; global.localStorage.setItem(CAP_STORE_KEY,JSON.stringify(m));}catch(e){} }

  function renderRows(modal, rows) {
    var list=getList(modal); if(!list) return; localizeModal(modal); list.innerHTML=''; var scope=getScope();
    (Array.isArray(rows)?rows:[]).forEach(function(row){
      var box=doc.createElement('div'); box.className='igdc-qa-thread';
      var q=doc.createElement('div'); q.className='igdc-qa-thread-q'; q.textContent='Q. '+text(row.question||row.q||'');
      var a=doc.createElement('div'); a.className='igdc-qa-thread-a'; a.textContent='A. '+(text(row.answer||row.a||'')||tr('pending'));
      var meta=doc.createElement('div'); meta.className='igdc-qa-thread-meta';
      var when=doc.createElement('span'); when.textContent=row.created_at?dateText(row.created_at):'';
      var tag=doc.createElement('span'); tag.textContent=row.is_admin?tr('admin'):tr('normal'); meta.appendChild(when); meta.appendChild(tag);
      var cap=row.id!=null ? getCap(scope,row.id):'';
      if(row.id!=null && (row.can_delete || cap)){
        var actions=doc.createElement('span'); actions.className='igdc-qa-thread-actions';
        var del=doc.createElement('button'); del.type='button'; del.className='igdc-qa-btn muted'; del.textContent=tr('delete'); del.setAttribute('data-igdc-qna-delete',clean(row.id,240));
        actions.appendChild(del); meta.appendChild(actions);
      }
      box.appendChild(q); box.appendChild(a); box.appendChild(meta); list.appendChild(box);
    });
    list.setAttribute('data-igdc-qna-storage','server');
  }

  async function request(url,init) {
    var res=await global.fetch(url,init); var raw=await res.text(); var body={};
    try{body=raw?JSON.parse(raw):{};}catch(e){body={ok:false,error:raw||'Invalid server response'};}
    if(!res.ok || !body.ok){ var error=body && (body.error || body.warnings&&body.warnings[0]) || ('HTTP '+res.status); throw new Error(clean(error,360)); }
    return body;
  }
  async function refresh(modal,quiet) {
    modal=modal||modalFor(); var list=getList(modal); if(!modal||!list) return null; localizeModal(modal);
    var scope=getScope(); if(!scope.page_id) return null;
    try{
      var query='?action=list&project='+encodeURIComponent(scope.project)+'&page_id='+encodeURIComponent(scope.page_id)+'&limit=100';
      var payload=await request(ENDPOINT+query,{method:'GET',cache:'no-store',credentials:'same-origin',headers:authHeaders(false)});
      renderRows(modal,payload.rows||[]); if(!quiet) setStatus(modal,'',false); return payload.rows||[];
    }catch(err){ if(!quiet) setStatus(modal,tr('loadFail'),true); try{console.warn('[IGDC Q&A] thread list load failed:',err);}catch(_){} return null; }
  }
  async function submit(modal) {
    modal=modal||modalFor(); var qbox=getQuestion(modal), abox=getAnswer(modal), btn=getSubmit(modal); if(!qbox) return; localizeModal(modal);
    var question=clean(qbox.value,4000); if(!question){qbox.focus();return;} var scope=getScope(); if(!scope.page_id){setStatus(modal,tr('saveFail'),true);return;}
    if(btn){btn.disabled=true;btn.setAttribute('aria-busy','true');} setStatus(modal,tr('saving'),false);
    try{
      var payload=await request(ENDPOINT,{method:'POST',credentials:'same-origin',headers:authHeaders(true),body:JSON.stringify({question:question,project:scope.project,page_id:scope.page_id,lang:langCode(),source:'qna-popup-bridge',meta:{project:scope.project,page_id:scope.page_id,lang:langCode(),ua:clean(global.navigator&&global.navigator.userAgent,500),channel:'popup'}})});
      qbox.value=''; if(abox) abox.value=text(payload.answer||'');
      if(payload.record && payload.record.id!=null && payload.delete_token) saveCap(scope,payload.record.id,payload.delete_token);
      setStatus(modal,tr('saved'),false); var rows=await refresh(modal,true); if(rows===null && payload.record) renderRows(modal,[payload.record]);
      try{doc.dispatchEvent(new CustomEvent('igdc:qna:stored',{detail:payload.record||null}));}catch(_){}
    }catch(err){ setStatus(modal,tr('saveFail'),true); try{console.error('[IGDC Q&A] save failed:',err);}catch(_){} }
    finally{if(btn){btn.disabled=false;btn.removeAttribute('aria-busy');btn.textContent=tr('submit');}}
  }
  async function removeThread(modal,id) {
    modal=modal||modalFor(); id=clean(id,240); if(!modal||!id) return; var scope=getScope(); var cap=getCap(scope,id);
    if(typeof global.confirm==='function' && !global.confirm(tr('confirm'))) return;
    setStatus(modal,tr('deleting'),false);
    try{
      await request(ENDPOINT,{method:'POST',credentials:'same-origin',headers:authHeaders(true),body:JSON.stringify({action:'delete',id:id,project:scope.project,page_id:scope.page_id,delete_token:cap})});
      dropCap(scope,id); setStatus(modal,tr('removed'),false); await refresh(modal,true);
    }catch(err){setStatus(modal,tr('deleteFail'),true); try{console.warn('[IGDC Q&A] delete failed:',err);}catch(_){}}
  }
  function scheduleRefresh(target) { var modal=modalFor(target); if(!modal) return; localizeModal(modal); if(refreshTimer) global.clearTimeout(refreshTimer); refreshTimer=global.setTimeout(function(){refresh(modal,false);},40); }

  doc.addEventListener('click',function(event){
    var target=event.target&&event.target.closest?event.target.closest('button,a,[role="button"]'):null; if(!target)return;
    var modal=modalFor(target);
    if(target.hasAttribute && target.hasAttribute('data-igdc-qna-delete') && modal){ event.preventDefault();event.stopImmediatePropagation();removeThread(modal,target.getAttribute('data-igdc-qna-delete'));return; }
    if(target.matches&&target.matches(SUBMIT_SELECTOR)&&modal&&modal.contains(target)){ event.preventDefault();event.stopImmediatePropagation();submit(modal);return; }
    var id=target.id||'';
    if(id==='qnaOpenBtn'||id==='qna열기Btn'||target.getAttribute('data-open')==='qna'||target.getAttribute('data-target')==='#qna'||target.getAttribute('data-target')==='#qnaModal'){ global.setTimeout(function(){scheduleRefresh(target);},70); }
  },true);

  var observer=new MutationObserver(function(records){
    var changed=false; records.forEach(function(record){Array.prototype.forEach.call(record.addedNodes||[],function(node){if(!node||node.nodeType!==1)return;if((node.matches&&node.matches(MODAL_SELECTOR))||(node.querySelector&&node.querySelector(MODAL_SELECTOR)))changed=true;});});
    if(changed){var m=modalFor(); if(m)localizeModal(m); scheduleRefresh();}
  });
  function start(){
    try{observer.observe(doc.documentElement||doc.body,{childList:true,subtree:true});}catch(_){}
    var modal=modalFor(); if(modal){localizeModal(modal);scheduleRefresh(modal);}
    global.IGDC_QA_STORAGE=global.IGDC_QA_STORAGE||{};
    global.IGDC_QA_STORAGE.refresh=function(){return refresh(modalFor(),false);};
    global.IGDC_QA_STORAGE.localize=function(){var m=modalFor(); if(m)localizeModal(m);};
  }
  if(doc.readyState==='loading') doc.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})(window,document);

/* MARU Windows public policy links — PG review reinforcement v1.0 */
(function (global, doc) {
  'use strict';
  if (global.__MARU_WINDOWS_POLICY_LINKS_V1__) return;
  global.__MARU_WINDOWS_POLICY_LINKS_V1__ = true;

  var LABELS = {
    ko:{title:'MARU Windows 정책 문서',terms:'이용약관',privacy:'개인정보처리방침',refund:'환불정책',note:'Windows용 MARU Media Player와 유료 AI 자막 서비스에 적용되는 공개 정책입니다.'},
    en:{title:'MARU Windows policies',terms:'Terms of Service',privacy:'Privacy Policy',refund:'Refund Policy',note:'Public policies for MARU Media Player for Windows and its paid AI subtitle services.'},
    ja:{title:'MARU Windows ポリシー',terms:'利用規約',privacy:'プライバシーポリシー',refund:'返金ポリシー',note:'Windows版MARU Media Playerと有料AI字幕サービスに適用される公開ポリシーです。'},
    zh:{title:'MARU Windows 政策文件',terms:'服务条款',privacy:'隐私政策',refund:'退款政策',note:'适用于 Windows 版 MARU Media Player 及其付费 AI 字幕服务的公开政策。'},
    zht:{title:'MARU Windows 政策文件',terms:'服務條款',privacy:'隱私權政策',refund:'退款政策',note:'適用於 Windows 版 MARU Media Player 及其付費 AI 字幕服務的公開政策。'},
    de:{title:'MARU Windows Richtlinien',terms:'Nutzungsbedingungen',privacy:'Datenschutzrichtlinie',refund:'Erstattungsrichtlinie',note:'Öffentliche Richtlinien für MARU Media Player für Windows und die kostenpflichtigen KI-Untertiteldienste.'},
    fr:{title:'Politiques MARU Windows',terms:'Conditions d’utilisation',privacy:'Politique de confidentialité',refund:'Politique de remboursement',note:'Politiques publiques applicables à MARU Media Player pour Windows et à ses services payants de sous-titres IA.'},
    es:{title:'Políticas de MARU Windows',terms:'Términos del servicio',privacy:'Política de privacidad',refund:'Política de reembolso',note:'Políticas públicas para MARU Media Player para Windows y sus servicios de subtítulos IA de pago.'},
    pt:{title:'Políticas do MARU Windows',terms:'Termos de Serviço',privacy:'Política de Privacidade',refund:'Política de Reembolso',note:'Políticas públicas do MARU Media Player para Windows e dos seus serviços pagos de legendas por IA.'},
    ru:{title:'Политики MARU Windows',terms:'Условия использования',privacy:'Политика конфиденциальности',refund:'Политика возврата',note:'Публичные правила для MARU Media Player для Windows и платных сервисов ИИ-субтитров.'},
    it:{title:'Politiche MARU Windows',terms:'Termini di servizio',privacy:'Informativa sulla privacy',refund:'Politica di rimborso',note:'Politiche pubbliche per MARU Media Player per Windows e i servizi a pagamento di sottotitoli IA.'},
    nl:{title:'MARU Windows-beleid',terms:'Servicevoorwaarden',privacy:'Privacybeleid',refund:'Restitutiebeleid',note:'Openbaar beleid voor MARU Media Player voor Windows en de betaalde AI-ondertitelingsdiensten.'},
    sv:{title:'MARU Windows-policyer',terms:'Användarvillkor',privacy:'Integritetspolicy',refund:'Återbetalningspolicy',note:'Offentliga policyer för MARU Media Player för Windows och dess betalda AI-undertexttjänster.'},
    pl:{title:'Zasady MARU Windows',terms:'Warunki korzystania',privacy:'Polityka prywatności',refund:'Polityka zwrotów',note:'Publiczne zasady dla MARU Media Player dla Windows i płatnych usług napisów AI.'},
    tr:{title:'MARU Windows politikaları',terms:'Hizmet Koşulları',privacy:'Gizlilik Politikası',refund:'İade Politikası',note:'Windows için MARU Media Player ve ücretli yapay zekâ altyazı hizmetlerine ilişkin kamuya açık politikalar.'},
    ar:{title:'سياسات MARU لنظام Windows',terms:'شروط الخدمة',privacy:'سياسة الخصوصية',refund:'سياسة الاسترداد',note:'السياسات العامة لمشغل MARU Media Player لنظام Windows وخدمات ترجمات الذكاء الاصطناعي المدفوعة.'},
    th:{title:'นโยบาย MARU Windows',terms:'ข้อกำหนดการให้บริการ',privacy:'นโยบายความเป็นส่วนตัว',refund:'นโยบายการคืนเงิน',note:'นโยบายสาธารณะสำหรับ MARU Media Player บน Windows และบริการคำบรรยาย AI แบบชำระเงิน'},
    vi:{title:'Chính sách MARU Windows',terms:'Điều khoản dịch vụ',privacy:'Chính sách quyền riêng tư',refund:'Chính sách hoàn tiền',note:'Các chính sách công khai áp dụng cho MARU Media Player trên Windows và dịch vụ phụ đề AI trả phí.'},
    id:{title:'Kebijakan MARU Windows',terms:'Ketentuan Layanan',privacy:'Kebijakan Privasi',refund:'Kebijakan Pengembalian Dana',note:'Kebijakan publik untuk MARU Media Player bagi Windows dan layanan subtitle AI berbayar.'},
    hi:{title:'MARU Windows नीतियाँ',terms:'सेवा की शर्तें',privacy:'गोपनीयता नीति',refund:'धनवापसी नीति',note:'Windows के लिए MARU Media Player और इसकी सशुल्क AI उपशीर्षक सेवाओं की सार्वजनिक नीतियाँ।'},
    ms:{title:'Dasar MARU Windows',terms:'Syarat Perkhidmatan',privacy:'Dasar Privasi',refund:'Dasar Bayaran Balik',note:'Dasar awam untuk MARU Media Player bagi Windows dan perkhidmatan sari kata AI berbayar.'},
    fa:{title:'سیاست‌های MARU Windows',terms:'شرایط خدمات',privacy:'سیاست حریم خصوصی',refund:'سیاست بازپرداخت',note:'سیاست‌های عمومی MARU Media Player برای Windows و خدمات پولی زیرنویس هوش مصنوعی.'},
    bn:{title:'MARU Windows নীতিমালা',terms:'সেবার শর্তাবলি',privacy:'গোপনীয়তা নীতি',refund:'রিফান্ড নীতি',note:'Windows-এর MARU Media Player এবং এর সশুল্ক AI সাবটাইটেল সেবার প্রকাশ্য নীতিমালা।'},
    ta:{title:'MARU Windows கொள்கைகள்',terms:'சேவை விதிமுறைகள்',privacy:'தனியுரிமைக் கொள்கை',refund:'பணத்தீர்ப்பு கொள்கை',note:'Windows-க்கான MARU Media Player மற்றும் கட்டண AI வசன சேவைகளுக்கான பொதுக் கொள்கைகள்.'},
    ur:{title:'MARU Windows پالیسیاں',terms:'سروس کی شرائط',privacy:'رازداری کی پالیسی',refund:'رقم واپسی کی پالیسی',note:'Windows کے لیے MARU Media Player اور اس کی بامعاوضہ AI سب ٹائٹل خدمات کی عوامی پالیسیاں۔'},
    sw:{title:'Sera za MARU Windows',terms:'Masharti ya Huduma',privacy:'Sera ya Faragha',refund:'Sera ya Marejesho',note:'Sera za umma za MARU Media Player ya Windows na huduma zake za kulipia za manukuu ya AI.'},
    hu:{title:'MARU Windows szabályzatok',terms:'Szolgáltatási feltételek',privacy:'Adatvédelmi szabályzat',refund:'Visszatérítési szabályzat',note:'A Windows rendszerű MARU Media Player és fizetős MI-felirat szolgáltatásainak nyilvános szabályzatai.'},
    uk:{title:'Політики MARU Windows',terms:'Умови користування',privacy:'Політика конфіденційності',refund:'Політика повернення',note:'Публічні правила для MARU Media Player для Windows і платних сервісів ШІ-субтитрів.'},
    uz:{title:'MARU Windows siyosatlari',terms:'Xizmat shartlari',privacy:'Maxfiylik siyosati',refund:'Qaytarish siyosati',note:'Windows uchun MARU Media Player va pulli AI subtitr xizmatlariga oid ochiq siyosatlar.'},
    tl:{title:'Mga patakaran ng MARU Windows',terms:'Mga Tuntunin ng Serbisyo',privacy:'Patakaran sa Privacy',refund:'Patakaran sa Refund',note:'Mga pampublikong patakaran para sa MARU Media Player para sa Windows at mga bayad na AI subtitle service.'}
  };
  var RTL = {ar:1,fa:1,ur:1};
  function lang(){
    var raw=(doc.documentElement.getAttribute('lang')||'en').toLowerCase().replace('_','-');
    if(raw==='zh-tw'||raw==='zh-hk'||raw==='zh-hant') return 'zht';
    raw=raw.split('-')[0];
    return LABELS[raw]?raw:'en';
  }
  function links(code){
    var t=LABELS[code]||LABELS.en;
    return '<div class="maruPolicyLinks" dir="'+(RTL[code]?'rtl':'ltr')+'">'+
      '<a href="maru-windows-terms.html?lang='+encodeURIComponent(code)+'" target="_blank" rel="noopener">'+t.terms+'</a>'+
      '<a href="maru-windows-privacy.html?lang='+encodeURIComponent(code)+'" target="_blank" rel="noopener">'+t.privacy+'</a>'+
      '<a href="maru-windows-refund.html?lang='+encodeURIComponent(code)+'" target="_blank" rel="noopener">'+t.refund+'</a>'+
    '</div>';
  }
  function style(){
    if(doc.getElementById('maruPolicyLinksStyle')) return;
    var s=doc.createElement('style'); s.id='maruPolicyLinksStyle';
    s.textContent='.maruPolicyPublicCard{grid-column:1/-1;background:#fff;border:1px solid #d9e4f2;border-radius:14px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.03)}.maruPolicyPublicCard h2{margin:0 0 8px;color:#004080;font-size:20px}.maruPolicyPublicCard p{margin:0 0 12px;line-height:1.6;color:#4c6177}.maruPolicyLinks{display:flex;gap:8px;flex-wrap:wrap}.maruPolicyLinks a{display:inline-block;text-decoration:none;border:1px solid #b9d2ee;background:#eef7ff;color:#004080;border-radius:9px;padding:9px 12px;font-weight:700}.maruPolicyLinks a:hover{text-decoration:underline}.maruProductSection .maruPolicyLinks{margin-top:8px}';
    doc.head.appendChild(s);
  }
  function install(){
    style(); var code=lang(),t=LABELS[code]||LABELS.en;
    var grid=doc.querySelector('.grid');
    if(grid){
      var card=doc.getElementById('maruPolicyPublicCard');
      if(!card){card=doc.createElement('article');card.id='maruPolicyPublicCard';card.className='maruPolicyPublicCard';grid.appendChild(card);}
      card.setAttribute('dir',RTL[code]?'rtl':'ltr');
      card.innerHTML='<h2>'+t.title+'</h2><p>'+t.note+'</p>'+links(code);
    }
    var body=doc.getElementById('maruProductInfoBody');
    if(body){
      var section=doc.getElementById('maruProductPolicySection');
      if(!section){section=doc.createElement('section');section.id='maruProductPolicySection';section.className='maruProductSection';body.appendChild(section);}
      section.innerHTML='<h3>'+t.title+'</h3><p>'+t.note+'</p>'+links(code);
    }
  }
  function start(){install();setTimeout(install,300);setTimeout(install,1200);new MutationObserver(function(){install();}).observe(doc.documentElement,{attributes:true,attributeFilter:['lang'],subtree:false});}
  if(doc.readyState==='loading') doc.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})(window, document);
