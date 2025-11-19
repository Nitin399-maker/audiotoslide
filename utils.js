// Style configurations with optimized prompts
export const OUTPUT_STYLES = {
  default: {
    name: "Default Summary",
    systemPrompt: `Create ONE presentation slide in JSON format.
RULES:
- Extract key points from transcript ONLY
- Vary format: bullets, numbered list, short paragraph, or key points
- give atleast four sentences for each slide with proper line breaks and emojis
- Max 200 chars total
- Use 2-4 emojis
- Title: 3-5 words + emoji
JSON format:
{"title": "Title 📌", "content": "Formatted content"}`
  },
  corporate: {
    name: "Corporate Presentation",
    systemPrompt: `Create ONE corporate slide in JSON format.
RULES:
- Professional business content from transcript
- give atleast four points for each slide with proper line breaks and emojis
- Vary format: summary, bullets, KPIs, or action items
- Max 200 chars
- Use: 🎯📊✅💼📈
- Title: 3-5 words + emoji
JSON format:
{"title": "Title 📊", "content": "Business content"}`
  },
  tweet: {
    name: "Tweet Style",
    systemPrompt: `Create ONE tweet-style slide in JSON format.
RULES:
- Conversational, shareable content
- Vary format: single point, key quotes, or insights
- give atleast four points for each slide with proper line breaks and emojis
- Max 200 chars
- Use: 🔹💡✨🚀⚡
- Title: 2-4 words + emoji
JSON format:
{"title": "Title 🔥", "content": "Tweet content"}`
  },
  poem: {
    name: "Poem Style",
    systemPrompt: `Create ONE poetic slide in JSON format.
RULES:
- Poetic expression from transcript
- Vary format: haiku, couplets, free verse
- give atleast four sentences for each slide with proper line breaks and emojis
- Max 200 chars
- Use: 🌟💫✨⭐🎭
- Title: 2-4 words + emoji
JSON format:
{"title": "Title 🌟", "content": "Poetic lines"}`
  },
  academic: {
    name: "Academic Paper",
    systemPrompt: `Create ONE academic slide in JSON format.
RULES:
- Scholarly presentation from transcript
- Vary format: question, method, findings, conclusion
- give atleast four points for each slide with proper line breaks and emojis
- Max 200 chars
- Use: 📚🔬📊💡🎓
- Title: 4-6 words + emoji
JSON format:
{"title": "Title 📚", "content": "Academic content"}`
  },
  storytelling: {
    name: "Storytelling",
    systemPrompt: `Create ONE narrative slide in JSON format.
RULES:
- Story-based content from transcript
- Vary format: scene, moment, lesson, quote
- give atleast four sentences for each slide with proper line breaks and emojis
- Max 200 chars
- Use: 🎬⭐🎯📖🌈
- Title: 3-5 words + emoji
JSON format:
{"title": "Title 🎬", "content": "Story content"}`
  },
  technical: {
    name: "Technical Documentation",
    systemPrompt: `Create ONE technical slide in JSON format.
RULES:
- Technical content from transcript
- Vary format: specs, architecture, how-to
- give atleast four points for each slide with proper line breaks and emojis
- Max 200 chars
- Use: ⚙️🔧💻🖥️⚡
- Title: 3-5 words + emoji
JSON format:
{"title": "Title ⚙️", "content": "Tech content"}`
  },
  marketing: {
    name: "Marketing Pitch",
    systemPrompt: `Create ONE marketing slide in JSON format.
RULES:
- Persuasive content from transcript
- Vary format: value, benefits, results, CTA
- give atleast four points for each slide with proper line breaks and emojis
- Max 200 chars
- Use: 💎🚀✨📈🎁
- Title: 2-4 words + emoji
JSON format:
{"title": "Title 💎", "content": "Marketing content"}`
  },
  eli5: {
    name: "Explain Like I'm 5",
    systemPrompt: `Create ONE simple slide in JSON format.
RULES:
- Simple explanation from transcript
- Vary format: explanation, analogy, example
- give atleast four sentences for each slide with proper line breaks and emojis
- Max 200 chars
- Use: 🎈🎨⭐😊🌈
- Title: 2-4 words + emoji
JSON format:
{"title": "Title 🎈", "content": "Simple content"}`
  }
};

// Reveal.js theme configurations
export const REVEAL_THEMES = {
  black: { name: "Black", file: "black.css" },
  white: { name: "White", file: "white.css" },
  moon: { name: "Moon", file: "moon.css" },
  sky: { name: "Sky", file: "sky.css" },
  serif: { name: "Serif", file: "serif.css" },
  night: { name: "Night", file: "night.css" },
  league: { name: "League", file: "league.css" },
  beige: { name: "Beige", file: "beige.css" },
  simple: { name: "Simple", file: "simple.css" },
  solarized: { name: "Solarized", file: "solarized.css" }
};

// Configuration
export const MIN_CHARS_FOR_SLIDE = 200;
export const SILENCE_THRESHOLD = 5000;

// Custom prompt management
export const getCustomPrompt = (styleKey) => {
  const stored = localStorage.getItem(`customPrompt_${styleKey}`);
  return stored || OUTPUT_STYLES[styleKey]?.systemPrompt || '';
};

export const setCustomPrompt = (styleKey, prompt) => {
  localStorage.setItem(`customPrompt_${styleKey}`, prompt);
};

// Utility: Remove duplicate sentences
export const removeDuplicateSentences = (text) => {
  const sentences = text.split(/([.!?]+\s+)/).filter(Boolean);
  const seen = new Set();
  const result = [];
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i]?.trim().toLowerCase();
    if (sentence && !seen.has(sentence)) {
      seen.add(sentence);
      result.push(sentences[i] + (sentences[i + 1] || ''));
    }
  }
  return result.join('').trim();
};

// Utility: Escape HTML
export const escapeHtml = (text) => {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
};

// LocalStorage
export const saveConfig = ($apiKey, $modelSelect, $styleSelect, $themeSelect) => {
  localStorage.setItem('liveSlidesConfig', JSON.stringify({
    apiKey: $apiKey.value,
    model: $modelSelect.value,
    style: $styleSelect.value,
    theme: $themeSelect.value
  }));
};

export const loadConfig = ($apiKey, $modelSelect, $styleSelect, $themeSelect) => {
  const config = JSON.parse(localStorage.getItem('liveSlidesConfig') || '{}');
  $apiKey.value = config.apiKey || '';
  $modelSelect.value = config.model || 'gpt-4o-mini-realtime-preview-2024-12-17';
  $styleSelect.value = config.style || 'default';
  $themeSelect.value = config.theme || 'league';
};

export const createPresentationHTML = (slides, escapeHtml, themeFile) => {
  const slidesHTML = slides.length > 0
    ? slides.map(s => `<section><h2>${escapeHtml(s.title)}</h2><div class="slide-content">${escapeHtml(s.content)}</div></section>`).join('')
    : '<section><h2>🎤 Live Slides</h2><p>Start speaking...</p></section>';
  return `<!DOCTYPE html>
<html><head><title>Live Presentation</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/reset.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/theme/${themeFile}" id="theme-link">
<style>
.reveal{font-size:33px}
.reveal h2{font-size:2em;margin-bottom:.6em;font-weight:bold;line-height:1.2}
.reveal .slide-content{font-size:1.3em;line-height:1.6;text-align:left;white-space:pre-line;padding:0 40px;max-width:100%;word-wrap:break-word}
.reveal section{text-align:center;padding:40px 20px;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center}
.reveal ul,.reveal ol{margin:0;padding:0;list-style-position:inside;text-align:left;width:100%}
.reveal li{margin-bottom:.4em;line-height:1.5}
</style></head><body>
<div class="reveal"><div class="slides" id="slides-container">${slidesHTML}</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/reveal.js"></script>
<script>
Reveal.initialize({width:800,height:600,margin:.05,minScale:.2,maxScale:1.5,hash:false,transition:'slide',controls:true,progress:true,center:true,autoSlide:0});
window.addSlide=(t,c)=>{const s=document.createElement('section');s.innerHTML='<h2>'+t+'</h2><div class="slide-content">'+c+'</div>';document.getElementById('slides-container').appendChild(s);Reveal.sync();Reveal.slide(Reveal.getTotalSlides()-1)};
window.goToSlide=i=>Reveal.slide(i);
window.updateTheme=n=>document.getElementById('theme-link').href='https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/theme/'+n+'.css';
</script></body></html>`;
};

// Download presentation as HTML file
export const downloadPresentationHTML = (slides, escapeHtml, themeFile) => {
  const html = createPresentationHTML(slides, escapeHtml, themeFile);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live-slides-${new Date().toISOString().split('T')[0]}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};