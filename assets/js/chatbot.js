
'use strict';
// CONFIGURE BEFORE PRODUCTION: HTTPS endpoint accepting POST JSON and returning {success:true,lead_id:"..."}.
// This standalone file intentionally has NO live submission endpoint and cannot save a lead remotely.
const CONFIG=Object.freeze(window.YELLO_CONFIG||{});
let KB=null;let fields=[];const $=x=>document.getElementById(x);let session,history=[],busy=false,lastTopic=null,unmatched=0,thoughtTimer=null;
const STORAGE_KEY='yello_assistant_conversation_v2';let currentOptions=[];
function persist(){try{if(!session)return;sessionStorage.setItem(STORAGE_KEY,JSON.stringify({v:2,session,history,options:currentOptions,lastTopic,unmatched,savedAt:Date.now()}))}catch(e){console.warn('Browser storage unavailable')}}
function restore(){try{let raw=sessionStorage.getItem(STORAGE_KEY);if(!raw)return false;let s=JSON.parse(raw);if(s.v!==2||!s.session||!Array.isArray(s.history)||s.history.length>350)return false;session=s.session;history=s.history;lastTopic=s.lastTopic||null;unmatched=s.unmatched||0;currentOptions=s.options||[];$('messages').innerHTML='';for(let m of history){let el=document.createElement('div');el.className='bubble '+(m.role==='user'?'user':'bot');el.textContent=String(m.text||'');$('messages').appendChild(el)}options(currentOptions);$('welcome').hidden=true;$('chat').hidden=false;syncCompleted();return true}catch(e){return false}}
function syncCompleted(){let done=session&&session.state==='submitted';$('completed').hidden=!done;$('form').hidden=done;$('requestLink').hidden=done; if(done)options([])}
function newConversation(){sessionStorage.removeItem(STORAGE_KEY);start()}
function reset(){session={state:'not_started',data:{},pending:null,emailSuggestion:null,consent:false,offered:{},active:false,previousQuestion:null,topic:null};history=[];lastTopic=null;unmatched=0;$('messages').innerHTML='';$('suggestions').innerHTML='';$('status').textContent='';$('notice').hidden=true;currentOptions=[];syncCompleted();persist();}
function show(){ $('panel').hidden=false;$('launcherWrap').hidden=true;}function hide(){$('panel').hidden=true;$('launcherWrap').hidden=false;}function start(){reset();$('welcome').hidden=true;$('chat').hidden=false;$('back').hidden=false;syncCompleted();bot('Hi there! 👋 Ask me a question about driving lessons, or request a callback from our team.', ['Lesson prices','Manual or Automatic','Areas we cover','Make an enquiry']);persist();$('input').focus()}
function wireUI(){ $('launcher').onclick=show;$('close').onclick=hide;$('restart').onclick=()=>{if(!confirm('Start a new conversation? Your current session chat will be cleared.'))return;newConversation()};$('newChatButton').onclick=newConversation;$('back').onclick=()=>{$('chat').hidden=true;$('welcome').hidden=false;$('back').hidden=true};$('start').onclick=()=>{if(history.length){$('welcome').hidden=true;$('chat').hidden=false;$('back').hidden=false}else start()};$('requestLink').onclick=()=>sendText('Make an enquiry');$('form').onsubmit=e=>{e.preventDefault();sendText($('input').value)}; }
function addBubble(text,type){const e=document.createElement('div');e.className='bubble '+type;e.textContent=text;$('messages').appendChild(e);$('messages').scrollTop=$('messages').scrollHeight;history.push({role:type,text});persist();return e}
function options(labels){currentOptions=[...labels];$('suggestions').innerHTML='';for(const t of labels.slice(0,6)){let b=document.createElement('button');b.className='chip';b.type='button';b.textContent=t;b.onclick=()=>sendText(t);$('suggestions').appendChild(b)}persist()}
function bot(t,opts=[]){addBubble(t,'bot');options(opts)}function normal(s){return String(s||'').toLowerCase().normalize('NFKD').replace(/[’‘]/g,"'").replace(/[^a-z0-9@.+\s'-]/g,' ').replace(/\s+/g,' ').trim()}
const stop=new Set('a an the i you your my me we our is are am do does can could would will what how much many to for from about and of it in on with please tell need want have be there any do they that this at by where'.split(' '));
function tokens(s){return normal(s).split(/\s+/).filter(x=>x.length>1&&!stop.has(x))}
function dist(a,b){if(Math.abs(a.length-b.length)>2)return 9;const d=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=d[0];d[0]=i;for(let k=1;k<=b.length;k++){let x=d[k];d[k]=Math.min(d[k]+1,d[k-1]+1,prev+(a[i-1]===b[k-1]?0:1));prev=x}}return d[b.length]}
function expand(s){let n=normal(s);const dict=KB.conversation_routing.abbreviation_expansions;const pairs=Object.entries(dict).sort((a,b)=>b[0].length-a[0].length);for(const [k,v] of pairs)n=n.replace(new RegExp('\\b'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','g'),v);return n.replace(/(.)\1{2,}/g,'$1$1').trim()}
function qaMatch(input){let q=expand(input),qt=tokens(q),best=null,second=0;
// Exact matching must happen before stop-word filtering: e.g. 'how are you?'
for(const item of KB.qa){for(const phrase of item.questions||[]){if(expand(phrase)===q)return item;}}
if(!qt.length)return null;for(let item of KB.qa){for(let phrase of item.questions||[]){const p=expand(phrase),pt=tokens(p);if(!p)continue;let score=0;if(q===p)score=1;else if(q.length>=10&&p.length>=8&&(q.includes(p)||p.includes(q)))score=.92;else if(q.length>=8 && Math.abs(q.length-p.length)<=2&&dist(q,p)<=2)score=.85;else if(qt.length&&pt.length){const common=qt.filter(x=>pt.some(y=>x===y||(x.length>=5&&y.length>=5&&dist(x,y)<=1))).length;const overlap=common/Math.max(qt.length,pt.length);score=overlap*(Math.min(qt.length,pt.length)<2?.45:.79);if(qt.length>=2&&pt.length>=2&&common>=2)score+=.06;}if(score>(best?.score||0)){second=best?.score||0;best={item,score}}else if(score>second)second=score;}}return best&&best.score>=.73&&(best.score-second>=.045||best.score>=.90)?best.item:null}
// Intent recognition for free-form enquiries: this must run before strict FAQ matching.
// It uses local, explainable phrasing rules rather than pretending to be a generative model.
function drivingIntent(text){
 const q=expand(text).replace(/\bdring\b|\bdrivng\b|\bdrving\b|\bdrivin\b/g,'driving').replace(/\blesons\b|\blesons\b|\blesns\b/g,'lessons');
 const words=q.split(/\s+/).filter(Boolean);
 const drive=words.some(w=>['drive','driving','driver','drivin','drivinglesson'].some(v=>w===v||(w.length>=4&&dist(w,v)<=1)));
 const lesson=words.some(w=>['lesson','lessons','tuition','classes','class','instructor'].some(v=>w===v||(w.length>=5&&dist(w,v)<=1)));
 const learn=/\b(learn|learning|start|begin|beginner|practice|practise|teach|training|need|want|looking|interested|book|get|take|enquir|refresher)\b/.test(q);
 const manual=/\b(manual|stick shift)\b/.test(q),automatic=/\b(automatic|auto)\b/.test(q);
 const price=/\b(price|prices|cost|how much|rate|fees|cheap|expensive)\b/.test(q);
 const availability=/\b(available|availability|weekend|tomorrow|next week|slots|times)\b/.test(q);
 // Avoid treating general questions such as 'learn JavaScript' as driving enquiries.
 if(!(drive||lesson||manual||automatic))return null;
 if(!(learn||lesson||manual||automatic||price||availability))return null;
 return {type:price?'price':availability?'availability':'interest',lessonType:automatic?'automatic':manual?'manual':null};
}
function approvedPricing(text){
 const q=expand(text);
 if(!/\b(price|prices|cost|how much|rate|rates|fees|package|offer|pay as you go|half day)\b/.test(q))return null;
 let id='QA-021';
 if(/half day|four hour|4 hour|semi intensive/.test(q))id='QA-025';
 else if(/five|5 lesson|package|block|discount|special offer|375/.test(q))id='QA-022';
 else if(/pay as you go|single|one lesson|90 minute|automatic|manual/.test(q))id='QA-024';
 const item=KB.qa.find(x=>x.id===id);
 return item?item.answer:null;
}
function availabilityAnswer(){return 'Our lesson availability depends on the days and times that work for you, as we need to find a suitable match. Which days and times are you usually available?';}
function enquiryReply(intent){
 session.topic=intent.lessonType||'driving_lessons';if(intent.lessonType)session.offered.lesson_type=intent.lessonType==='automatic'?'Automatic':'Manual';unmatched=0;
 const label=intent.lessonType?intent.lessonType+' driving lessons':'driving lessons';
 const opener=intent.type==='price'?(approvedPricing(label+' price')||'Our team can confirm current prices.') :intent.type==='availability'?availabilityAnswer():`I'd be happy to help you enquire about ${label}! 🚗`;
 return {text:opener+'\n\n'+KB.lead_capture.consent_prompt,opts:['Yes, prepare my enquiry','No thanks'],askConsent:true};
}
function isGibberish(s){let n=normal(s).replace(/\s/g,'');return (n.length>=5&&/[^a-z0-9]/.test(n)&&!s.includes('@'))||(/\d/.test(n)&&/[a-z]/.test(n)&&!/(wa\d|ch\d)/i.test(n)&&n.length>13)||(/^([a-z]{1,3})\1{3,}$/.test(n))||(/^[asdfghjklqwertyuiopzxcvbnm]{9,}$/.test(n)&& !/[aeiou].*[aeiou]/.test(n))}
function sayFallback(category){let arr=KB.fallbacks[category]||KB.fallbacks.unclear;return arr[(unmatched++)%arr.length]}
function getEmail(s){return String(s).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]||null}
// A single UK phone parser handles extraction, validation and feedback. Never accept a
// partial substring of a malformed number (e.g. +44 0... or extra/missing digits).
function parseUKPhone(value){
  const raw=String(value||'').trim();
  const cleaned=raw.replace(/^(?:(?:my|the)\s+)?(?:(?:contact|mobile|telephone|phone)\s*)?(?:number|no\.?|phone|mobile)?\s*(?:is|:|=)\s*/i,'').trim();
  if(!cleaned || !/^(?:\+|00)?[\d\s().\-]+$/.test(cleaned))return {valid:false,reason:'not_number'};
  const digits=cleaned.replace(/\D/g,'');
  let local='';
  if(cleaned.startsWith('+44')||digits.startsWith('0044')||digits.startsWith('44')){
    const pref=digits.startsWith('0044')?'0044':'44';
    const rest=digits.slice(pref.length);
    if(rest.startsWith('0'))return {valid:false,reason:'extra_zero',suggestion:'+44 '+rest.slice(1)};
    local=rest;
    if(local.length!==10)return {valid:false,reason:local.length<10?'short':'long'};
  }else if(digits.startsWith('0')){
    if(digits.length!==11)return {valid:false,reason:digits.length<11?'short':'long'};
    local=digits.slice(1);
  }else{
    // A bare 10-digit UK mobile can be proposed, but is not silently accepted.
    if(/^7\d{9}$/.test(digits))return {valid:false,reason:'missing_prefix',suggestion:'0'+digits};
    return {valid:false,reason:'prefix'};
  }
  // Standard UK mobile numbers (07...) and geographic landlines (01/02...).
  if(!/^[127]\d{9}$/.test(local))return {valid:false,reason:'range'};
  return {valid:true,number:'0'+local};
}
function getPhone(s){
  // Capture full number from a labelled field or a standalone phone reply.
  const str=String(s||'').trim();
  const labelled=str.match(/\b(?:phone|mobile|contact|telephone)(?:\s+(?:number|no))?\s*(?:is|:|=)\s*([+\d][\d\s().-]{7,25})/i);
  if(labelled){let r=parseUKPhone(labelled[1]);return r.valid?r.number:null;}
  const r=parseUKPhone(str);return r.valid?r.number:null;
}
function phoneFeedback(text){
  const result=parseUKPhone(text);
  if(result.valid)return null;
  const examples='For example, 07123 456789 or +44 7123 456789.';
  if(result.reason==='extra_zero')return 'Please remove the extra 0 after +44. For example, +44 7123 456789 (not +44 07123 456789). Could you resend your number?';
  if(result.reason==='short')return 'That phone number looks incomplete — it needs another digit or more. '+examples+' Could you check and resend it?';
  if(result.reason==='long')return 'That phone number appears to have too many digits. '+examples+' Could you check and resend it?';
  if(result.reason==='missing_prefix')return 'Did you mean '+result.suggestion+'? Please enter the number with its leading 0, or use +44 instead.';
  if(result.reason==='range')return 'That does not look like a standard UK mobile or geographic landline number. '+examples+' Could you check it?';
  if(result.reason==='prefix')return 'Please enter a UK contact number starting with 0, or +44 without the leading 0. '+examples;
  return 'I couldn’t recognise that as a phone number. '+examples+' Could you type it again?';
}
function emailSuggestion(raw){
  // Only suggest obvious, deterministic corrections; never silently change a visitor's address.
  const match=String(raw).match(/[a-z0-9._%+\-]+@[a-z0-9.\-,]+/i);
  if(!match)return null;
  const original=match[0].replace(/[;,]+$/,'');
  let suggested=original.replace(/\.{2,}/g,'.').replace(/,com$/i,'.com').replace(/\s+/g,'');
  const known={gmailcom:'gmail.com','gmal.com':'gmail.com','gmial.com':'gmail.com','gmai.com':'gmail.com',hotmailcom:'hotmail.com','hotmial.com':'hotmail.com',outlookcom:'outlook.com',yahoocom:'yahoo.com','yaho.com':'yahoo.com'};
  const at=suggested.lastIndexOf('@');if(at<1)return null;
  let domain=suggested.slice(at+1).toLowerCase();
  if(known[domain])suggested=suggested.slice(0,at+1)+known[domain];
  if(original.toLowerCase()===suggested.toLowerCase()||!valid('email',suggested))return null;
  return {original,suggested};
}
function emailCheckMessage(s){return `Did you mean ${s}? Please reply Yes to use this email, or type your email address again.`}
function valid(k,v){if(!v)return false;v=String(v).trim();if(k==='lesson_type')return /^(manual|automatic)$/i.test(v);if(k==='availability')return v.length>=3&&v.length<=160&&!/^(yes|no|thanks|hello|manual|automatic|confirm)$/i.test(v);if(k==='name')return /^[\p{L}][\p{L}' .-]{2,79}$/u.test(v)&&v.split(/\s+/).length>=2&&!/(thank|hello|how are|driving|lesson|price|automatic|manual)/i.test(v);if(k==='email')return /^[^\s@.]+(?:\.[^\s@.]+)*@[^\s@.]+(?:\.[^\s@.]+)+$/.test(v)&&!v.includes('..')&&v.length<180;if(k==='phone')return parseUKPhone(v).valid;if(k==='address')return v.length>=4&&v.length<=230&&!/^(yes|no|confirm|thanks|hello)$/i.test(v);return false}
function extract(text){let out={};
const topic=normal(text);
if(/^(manual|automatic)(?:\s+(?:lessons|driving lessons))?$/.test(topic))out.lesson_type=topic.startsWith('auto')?'Automatic':'Manual';
else if(/\b(?:i (?:want|need|prefer|am looking for)|looking for)\s+(?:some\s+)?(?:manual|automatic)\b/.test(topic))out.lesson_type=/automatic/.test(topic)?'Automatic':'Manual';
const timeLabel=String(text).match(/(?:my availability is|i(?:'m| am) available|i can do|free on|available on|preferred (?:days|times)(?: are)?)\s*[:,-]?\s*(.{3,110})/i);
if(timeLabel&&valid('availability',timeLabel[1].trim()))out.availability=timeLabel[1].trim();
let ph=getPhone(text);if(ph)out.phone=ph;let n=text.match(/(?:my name is|call me|i'm|i am)\s+([\p{L}][\p{L}' .-]{2,60}?)(?:[,.!?]|\s+(?:and|my email|my number|my phone|i live|from)\b|$)/iu);if(n&&valid('name',n[1].trim()))out.name=n[1].trim();let addr=text.match(/(?:my address is|address is|i live (?:at|in)|based in|i'm from|my postcode is|postcode is)\s+(.{4,100}?)(?:[.!?]|\s+(?:and my|my email|my number)\b|$)/i);if(addr&&valid('address',addr[1].trim()))out.address=addr[1].trim();let postcode=text.match(/\b(?:GIR\s?0AA|(?:[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}))\b/i);if(postcode&&!out.address)out.address=postcode[0];if(session.pending&& !out[session.pending]&&valid(session.pending,text.trim())&& !/\?/.test(text)){if(session.pending==='availability'&&valid('availability',text.trim())&& !/\?/.test(text))out.availability=text.trim();if(session.pending==='name' && text.split(/\s+/).length<=5)out.name=text.trim();if(session.pending==='email'&&valid('email',text.trim()))out.email=text.trim();if(session.pending==='phone'&&valid('phone',text.trim()))out.phone=text.trim();if(session.pending==='address'&&text.length<150)out.address=text.trim()}return out}
function missing(){return fields.find(f=>!valid(f,session.data[f]))}function question(){let k=missing();session.pending=k;return k?KB.lead_capture.fields.find(x=>x.key===k).ask:null}
function beginConsent(){session.state='consent_requested';session.pending=null;return {text:KB.lead_capture.consent_prompt,opts:['Yes, prepare my enquiry','No thanks']}}
function consentYes(t){
  // Accept ordinary consent language and common typing mistakes, but not ambiguous replies.
  // Run only while consent_requested; do not treat other messages as permission.
  const q=normal(t).replace(/[,!?\.]+/g,' ').replace(/\s+/g,' ').trim();
  if(/^(yes|yeah|yea|yep|yup|y|sure|ok|okay|of course|certainly|i agree|i consent|i do|go ahead|please do|yes prepare my enquiry|yes start|yes proceed)$/.test(q))return true;
  const pieces=q.split(/\s+/);
  if(pieces.length>=2&&pieces.length<=3&&/^(yes|yeah|yep|yup|sure|ok|okay)$/.test(pieces[0])&&/^(please|pelase|plese|pleas|pls|plz)$/.test(pieces[1])&&(pieces.length===2||pieces[2]==='do'))return true;
  return false;
}
function consentNo(t){return /^(no|no thanks|not now|nope|i decline|cancel|stop)$/i.test(normal(t))}
function printSummary(){session.emailSuggestion=null;session.state='confirmation_pending';session.pending=null;let d=session.data;return {text:KB.lead_capture.confirmation_template.replace(/{{(\w+)}}/g,(_,k)=>d[k]||'—'),opts:KB.lead_capture.confirmation_buttons}}
function cancelLead(){session.emailSuggestion=null;session.data={};session.offered={};session.pending=null;session.consent=false;session.state='declined';return {text:'No problem. I’ve cleared the unsubmitted enquiry details from this conversation. Is there another Yello Driving School question I can help with?',opts:['Manual lessons','Automatic lessons','No thanks']}}
function fieldsFromReply(t){let extracted=extract(t);for(let [k,v] of Object.entries(extracted))if(valid(k,v))session.data[k]=v;return Object.entries(extracted).filter(([k,v])=>valid(k,v)).length}
function specialIntent(t){const s=expand(t);if(/\b(emergency|crash|accident|injured|unconscious|fire|immediate danger)\b/.test(s))return {text:'If someone is in immediate danger or seriously injured, call 999 in the UK. Please move to safety if you can do so safely.',opts:[]};return null}
function answer(text){const q=expand(text);let emergency=specialIntent(text);if(emergency)return emergency;
// Conversational messages take priority over form-field parsing unless a field is explicitly supplied.
// This lets 'how are you' work even while collecting details, without treating it as a name/address.
const SMALL_TALK = [
  [/^(?:hi+|hey+|hello+|helo|hiya|yo|good morning|good afternoon|good evening|greetings|hey there|hello there)$/i, 'greeting'],
  [/^(?:how are you|how are you doing|how you doing|how is it going|how's it going|how have you been|you okay|are you okay|how r you|hru)$/i, 'how_are_you'],
  [/^(?:where are you from|where do you come from|where are you located|where do you live)$/i, 'where_are_you_from'],
  [/^(?:who are you|what is your name|what's your name|are you a robot|are you human|are you real)$/i, 'identity'],
  [/^(?:thanks|thank you|thank you so much|cheers|thx|ty)$/i, 'thanks'],
  [/^(?:bye|goodbye|see you|see you later|cya)$/i, 'goodbye']
];
const smallTalk = SMALL_TALK.find(([pattern])=>pattern.test(q));
if(smallTalk && session.state!=='confirmation_pending'){
  const intent=smallTalk[1];const exact=KB.qa.find(x=>x.intent===intent || (intent==='identity' && /^(who_are_you|what_s_your_name|are_you_a_real_person)$/.test(x.intent)) || (intent==='thanks' && /thank_you|thanks/.test(x.intent)) || (intent==='goodbye' && /goodbye|bye/.test(x.intent)));
  const preset={greeting:'Hello! 👋 Welcome to Yello Driving School. How may I help you?',how_are_you:"I’m doing well, thank you! 😊 Are you looking for driving lessons or would you like to make an enquiry?",where_are_you_from:"I’m Yello Driving School’s virtual assistant. Our school is based around Frodsham and Helsby in Cheshire. How can I help?",identity:"I’m Yello Assistant, a virtual receptionist here to help with driving lesson questions and enquiries.",thanks:"You’re very welcome! 😊 Is there anything else I can help you with?",goodbye:"Goodbye! Thanks for visiting Yello Driving School."};
  const nextQuestion=session.state==='collecting'&&session.pending ? '\n\n'+question() : '';
  return {text:(exact?.answer||preset[intent])+nextQuestion,opts:session.state==='collecting'?[]:['Manual lessons','Automatic lessons','Make an enquiry']};
}

if(session.state==='confirmation_pending'){
if(/^(confirm details|confirm|yes all correct|everything is correct|correct)$/i.test(q))return {submit:true};
if(/^(cancel|delete|discard|stop)$/i.test(q))return cancelLead();
let edit=q.match(/^edit (lesson type|availability|name|phone|address)$/);if(edit){session.state='collecting';session.pending=edit[1].replace(' ','_');return{text:'Of course. '+KB.lead_capture.fields.find(x=>x.key===session.pending).ask,opts:[]}}
const correction=q.match(/(?:change|update|correct|replace)\s+(?:my\s+)?(lesson type|availability|name|phone|address)\s+(?:to|with|is|:)\s+(.+)/);if(correction){let k=correction[1].replace(' ','_'),v=correction[2];if(!valid(k,v)){session.pending=k;session.state='collecting';return{text:'That doesn’t look quite right. '+KB.lead_capture.fields.find(x=>x.key===k).ask}}session.data[k]=v;return printSummary()}
let newVals=extract(text);if(Object.keys(newVals).length){for(let[k,v]of Object.entries(newVals))if(valid(k,v))session.data[k]=v;return printSummary()}
return{text:'Please select “Confirm details” only if all five details are correct, or choose which detail you would like to edit.',opts:KB.lead_capture.confirmation_buttons}}
if(session.state==='consent_requested'){
if(consentYes(text)){
  session.consent=true;session.state='collecting';
  for(const [k,v] of Object.entries(session.offered||{}))if(valid(k,v))session.data[k]=v;
  session.offered={};fieldsFromReply(text);
  return missing()?{text:'Great! '+question(),opts:[]}:printSummary();
}
if(consentNo(text))return cancelLead();
// Visitor may supply contact data before answering the explicit consent request.
// Keep it TEMPORARILY in session memory, not in submitted lead data, until they opt in.
const offered=extract(text);if(Object.keys(offered).length){
  for(const[k,v]of Object.entries(offered))if(valid(k,v))session.offered[k]=v;
  const names=Object.keys(session.offered).map(k=>KB.lead_capture.fields.find(f=>f.key===k).label.toLowerCase());
  return{text:'Thanks for sharing '+(names.join(', ')||'those details')+'. Before I use them for a Yello enquiry, may I have your permission to collect your contact details and pass them to the Yello team to respond? Please select Yes or No.',opts:['Yes, prepare my enquiry','No thanks']};
}
// For normal questions, answer as usual and keep consent prompt available without restarting the flow.
let matched=qaMatch(text);if(matched)return{text:matched.answer+'\n\nWould you like to prepare an enquiry for the team?',opts:['Yes, prepare my enquiry','No thanks']};
let interest=drivingIntent(text);if(interest)return{text:'I can help with your driving lesson enquiry. Would you like to share your contact details so the team can respond?',opts:['Yes, prepare my enquiry','No thanks']};
if(isGibberish(text))return{text:sayFallback('gibberish'),opts:['Yes, prepare my enquiry','No thanks']};
return{text:'I can answer questions, or help prepare an enquiry. Would you like me to collect your details for the Yello team?',opts:['Yes, prepare my enquiry','No thanks']};
}
if(session.state==='collecting'){
if(/^(cancel|stop|delete my details|discard)$/i.test(q))return cancelLead();
let oldPending=session.pending;
let count=fieldsFromReply(text);if(count){if(missing())return{text:question(),opts:[]};return printSummary()}
if(oldPending==='phone'){return{text:phoneFeedback(text),opts:[]};}
if(oldPending&&/^(skip|prefer not|rather not|no thanks)$/i.test(q))return{text:'That’s fine; you don’t have to share that detail. I can still answer general questions, but all five details are needed to submit an enquiry here. Would you like to stop collecting your details?',opts:['Cancel','Continue']};
let matched=qaMatch(text);if(matched)return{text:matched.answer+'\n\n'+question(),opts:[]};
let help=oldPending==='lesson_type'?'Please choose Manual or Automatic. ':oldPending==='availability'?'Please tell me the days and times that work for you, such as weekdays after 5pm. ':oldPending==='name'?'Please provide your full name (first and surname). ':oldPending==='phone'?'Please enter a UK phone number such as 07123 456789 or +44 7123 456789. ':oldPending==='email'?'Please check the email format, e.g. name@example.com. ':'';
return{text:help+'I couldn’t validate that '+(oldPending||'detail')+'. '+question(),opts:[]}}
if(session.state==='submitted')return {text:'Thanks again! Is there anything else I can help you with? You can also select Start New Chat.',opts:[]};
if(/\b(availability|available|free slots|lesson slots|which days|what days|what times|when can (?:i|we) book)\b/.test(q)&&/\b(your|you|instructor|lessons|slots|available|availability)\b/.test(q))return {text:availabilityAnswer(),opts:['Make an enquiry','Manual lessons','Automatic lessons']};
const pricing=approvedPricing(text);
if(pricing)return {text:pricing+'\n\nWould you like to prepare an enquiry?',opts:['Yes, prepare my enquiry','No thanks'],askConsent:true};
let interest=drivingIntent(text);if(interest && !/\b(what|which|why|difference|explain|tell me about)\b/.test(q))return enquiryReply(interest);
let qa=qaMatch(text);if(qa){session.topic=qa.category;unmatched=0;let triggers=/price|cost|booking|book|availability|lesson|automatic|manual|instructor|area|cover|contact|enquir|callback/i.test(qa.category+' '+qa.intent);if(triggers&&session.state!=='declined')return{text:qa.answer+'\n\n'+KB.lead_capture.consent_prompt,opts:['Yes, prepare my enquiry','No thanks'],askConsent:true};return{text:qa.answer,opts:['Manual lessons','Automatic lessons','Make an enquiry']}}
if(/^(make an enquiry|request a callback|book a lesson|contact the team)$/i.test(q))return {...beginConsent(),askConsent:true};
if(isGibberish(text))return{text:sayFallback('gibberish'),opts:['Manual lessons','Lesson prices','Contact the team']};
if(/\b(weather|football|politics|recipe|movie|bitcoin|stocks|celebrity|coding|javascript)\b/.test(q))return{text:sayFallback('off_topic'),opts:['Driving lessons','Lesson prices','Make an enquiry']};
return{text:sayFallback('unclear'),opts:['Manual lessons','Automatic lessons','Make an enquiry']};}
// CLIENT PREVIEW ONLY: no request is sent, and no lead is saved to a server.
// This state is a visual demonstration of the eventual success flow.
async function submitLead(){
  if(!session.consent || session.state!=='confirmation_pending' || fields.some(k=>!valid(k,session.data[k])))
    return {text:'Please review and confirm all five details first.',opts:KB.lead_capture.confirmation_buttons};
  session.state='submitted';
  persist();
  return {text:'Thank you! Your details are confirmed for this preview. When the live version is connected, the Yello team will receive your enquiry and get in touch. 😊\n\nIs there anything else I can help you with?',opts:[]};
}
function setBusy(v){busy=v;$('send').disabled=v;$('input').disabled=v;$('status').textContent=v?'Yello Assistant is thinking…':''}
async function sendText(raw){let text=String(raw||'').trim();if(!text||busy)return;addBubble(text,'user');$('input').value='';options([]);setBusy(true);let typing=document.createElement('div');typing.className='bubble bot';typing.innerHTML='<span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span>';$('messages').appendChild(typing);$('messages').scrollTop=$('messages').scrollHeight;let delay=CONFIG.minimumThinkMs+Math.random()*(CONFIG.maximumThinkMs-CONFIG.minimumThinkMs);await new Promise(r=>setTimeout(r,delay));try{let out=answer(text);if(out.askConsent){session.state='consent_requested'}if(out.submit)out=await submitLead();typing.remove();bot(out.text,out.opts||[]);syncCompleted();persist()}catch(err){typing.remove();bot('Sorry, I could not process that just now. Could you try again?')}finally{setBusy(false);$('input').focus()}}
async function init(){
  $('launcher').disabled=true;
  try {
    const response=await fetch(CONFIG.knowledgeBaseUrl,{cache:'no-store'});
    if(!response.ok)throw new Error('Knowledge base returned '+response.status);
    const data=await response.json();
    if(!data || !Array.isArray(data.qa) || !data.chatbot_policy || !data.conversation_routing || !data.lead_capture || !data.fallbacks)throw new Error('Invalid knowledge base structure');
    KB=data; fields=KB.lead_capture.fields.map(f=>f.key);
    if(fields.join(',')!=='lesson_type,availability,name,phone,address')throw new Error('Expected lesson_type, availability, name, phone, address fields');
    wireUI();if(!restore()){reset();$('welcome').hidden=false;$('chat').hidden=true}else{$('back').hidden=false;} $('launcher').disabled=false;
    $('launcher').title=`Knowledge base loaded: ${KB.qa.length} Q&A records`;
  }catch(err){
    console.error('Yello knowledge base loading failed:',err);
    $('launcher').disabled=true;
    $('launcher').textContent='Chat unavailable';
    alert('Unable to load the Yello chatbot knowledge base. Serve the folder using a local or website server, rather than opening index.html directly from disk.');
  }
}
init();

