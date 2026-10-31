/* Disposable UI prototype: in-memory fixtures only. No API clients, storage,
   model calls or sending. CSP connect-src 'none' independently enforces this. */
'use strict';
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const projects = [
  { id: 'handoff', name: '交付笔记', summary: '让独立设计师的每一次交付，都少一点来回确认。', audience: '同时服务多个客户的独立设计师', alternative: '微信群、邮件和手工维护的交付清单。', question: '反复确认交付范围，真的是一个值得解决的问题吗？', note: '先不要做项目管理工具。\n我想知道：最后一次交付中，客户具体在哪一步产生了误解？', hypotheses: [
    { text: '交付边界不清，比文件传输本身更耗时间。', detail: '需要最近一次实际交付的例子，而不是对产品的赞美。' },
    { text: '设计师愿意在交付前花 3 分钟整理一份清单。', detail: '愿意尝试，不等于会持续使用或付费。' }], experiments: [{ title: '还原一次真实交付', hypothesis: '反复确认范围是高频、可感知的负担。', method: '请 5 位独立设计师回顾最近一次交付，展示实际沟通片段。', criteria: '提议：至少 3 人能举出重复出现且有实际代价的例子；否则重新界定问题。', status: 'draft' }], evidence: [
      { source: '演示访谈 A · 虚构材料', quote: '文件发出去了，客户又问了一遍哪些还可以修改。', stance: 'supports', interpretation: '可能是边界表达问题，还不能判断发生频率。' },
      { source: '演示访谈 B · 虚构材料', quote: '我有固定的交付邮件模板，很少再被追问。', stance: 'challenges', interpretation: '模板可能已经足够；需要调查谁还没有被替代方案满足。' }], decisions: [] },
  { id: 'reading', name: '读后一步', summary: '把读过的文章，变成一次能做的小行动。', audience: '想把阅读用在实际项目上的人', alternative: '收藏夹、笔记和每周回顾。', question: '读完以后没行动，是忘记了，还是内容本来就不重要？', note: '', hypotheses: [{ text: '卡住的不是记录，而是把知识对应到当前任务。', detail: '目前只是一个猜测。' }], experiments: [], evidence: [], decisions: [] },
];
const inbox = [{ id: 'spark-1', name: '会后的一句话', note: '会议结束后，只留下一个决定、一个负责人和一个日期。先问问大家现在怎样做。' }, { id: 'spark-2', name: '给小店的补货提醒', note: '朋友说补货总是靠记忆。到底是预测问题，还是记录成本太高？' }];
const state = { page: 'handoff', view: 'overview', layout: 'desk', partnerOpen: true, mobilePartner: false, navOpen: false, chats: {}, chatDrafts: {}, suggestions: {} };
const labels = { overview: '概览', experiments: '实验', outreach: 'Outreach', evidence: '证据与决定' };
const stanceLabels = { supports: '支持线索', challenges: '反例', unknown: '尚不明确' };
const workspace = $('#workspace');
let modalSubmit = null;
let modalOpener = null;
let toastTimer;
function project() { return projects.find((p) => p.id === state.page); }
function badge(text, kind = '') { return `<span class="badge ${kind}">${esc(text)}</span>`; }
function button(text, action, cls = '', extra = '') { return `<button type="button" class="${cls}" data-action="${action}" ${extra}>${text}</button>`; }
function notify(text) { const toast = $('#toast'); toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500); }
function readLocation() {
  const params = new URLSearchParams(location.hash.slice(1));
  const page = params.get('project');
  state.page = ['all', 'inbox', 'references', ...projects.map(p => p.id)].includes(page) ? page : 'handoff';
  state.view = Object.hasOwn(labels, params.get('view')) ? params.get('view') : 'overview';
  state.layout = params.get('layout') === 'journal' ? 'journal' : 'desk';
}
function navigate(page, view = 'overview') {
  state.page = page; state.view = view; state.navOpen = false; state.mobilePartner = false;
  history.pushState(null, '', `#${new URLSearchParams({ project: page, view, layout: state.layout })}`);
  render(true);
}
window.addEventListener('popstate', () => { readLocation(); state.mobilePartner = false; state.navOpen = false; render(true); });
function navigation() {
  return `<div class="nav-top">${[['all', '实验室总览', '⌂'], ['inbox', '想法收件箱', '＋']].map(([id, text, icon]) => `<button class="nav-button" data-page="${id}" ${state.page === id ? 'aria-current="page"' : ''}><span class="nav-symbol" aria-hidden="true">${icon}</span><span>${text}</span>${id === 'inbox' ? `<small>${inbox.length}</small>` : ''}</button>`).join('')}</div>
    <div class="nav-group"><p class="nav-heading">正在探索 / PROJECTS</p><div class="nav-projects">${projects.map((p) => `<button class="nav-button" data-page="${p.id}" ${state.page === p.id ? 'aria-current="page"' : ''}><i class="project-dot ${p.experiments.length ? '' : 'soft'}" aria-hidden="true"></i><span>${esc(p.name)}</span></button>`).join('')}</div>${button('＋ 记录想法', 'capture', 'nav-button')}</div>
    <div class="nav-group reference-nav"><p class="nav-heading">需要时再打开</p><button class="nav-button" data-page="references" ${state.page === 'references' ? 'aria-current="page"' : ''}><span class="nav-symbol" aria-hidden="true">↗</span><span>参考资料与原有工具</span></button></div>
    <div class="nav-foot"><p>不是把每个想法做出来，<br>而是知道哪个值得继续。</p><a href="/product" target="_blank" rel="noopener">打开现有产品页 ↗</a><p>离开样板 · 不会迁移演示内容</p></div>`;
}
function heading(title, description, action = '') { return `<header class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="actions">${action}${!project() ? button('打开伙伴', 'partner', 'outlined partner-open-button') : ''}</div></header>`; }
function overview(p) {
  return `<section class="question"><span class="eyebrow">本轮问题 / QUESTION FIRST</span><h2>${esc(p.question)}</h2><div class="question-foot"><p>先确认问题，再讨论该做什么。</p>${button('和伙伴推敲 ↗', 'ask', 'text-button', 'data-prompt="challenge"')}</div></section>
    <div class="facts"><div><span class="fact-label">为谁解决</span><p>${esc(p.audience)}</p></div><div><span class="fact-label">他们现在怎样做</span><p>${esc(p.alternative)}</p></div></div>
    <section class="section"><div class="section-head"><h2>什么必须成立 <small>${p.hypotheses.length} 个假设</small></h2>${button('补充假设', 'hypothesis', 'text-button')}</div>${p.hypotheses.map((h, i) => `<div class="hypothesis"><span class="number">0${i + 1}</span><div><h3>${esc(h.text)}</h3><p>${esc(h.detail)}</p></div>${badge('待验证', 'warm')}</div>`).join('')}</section>
    <section class="section"><div class="section-head"><h2>下一次小实验</h2>${button('查看实验 →', 'view-experiments', 'text-button')}</div>${p.experiments.length ? `<p>${esc(p.experiments.at(-1).title)}</p><p class="muted">${esc(p.experiments.at(-1).method)}</p>` : `<p class="muted">还没有实验。从最容易推翻的一个假设开始。</p>${button('设计第一个实验', 'experiment', 'outlined')}</section>`}${p.experiments.length ? '</section>' : ''}
    <section class="section"><div class="section-head"><h2>随手记</h2><small>仅当前样板页面</small></div><label class="notebook-label"><span class="fact-label">原始想法、疑问和还没想明白的地方</span><textarea id="project-note" rows="4" placeholder="不用写成一份商业计划…">${esc(p.note)}</textarea></label><p class="save-note" id="note-status">切换视图保留 · 刷新后重置</p></section>`;
}
function experiments(p) {
  return `<div class="section-head"><div><h2>一次只回答一个问题。</h2><p class="muted">实验标准由你决定；讨论不会自动启动实验。</p></div>${button('＋ 新实验', 'experiment', 'primary')}</div>
  ${p.experiments.length ? p.experiments.map((e, i) => `<article class="experiment"><span class="eyebrow">EXPERIMENT ${String(i + 1).padStart(2, '0')}</span> ${badge(e.status === 'closed' ? '已记录结论' : '草案 · 标准未批准', e.status === 'closed' ? '' : 'warm')}<h3>${esc(e.title)}</h3><dl><dt>核心假设</dt><dd>${esc(e.hypothesis)}</dd><dt>怎样验证</dt><dd>${esc(e.method)}</dd><dt>判断标准</dt><dd>${esc(e.criteria)}</dd></dl><div class="actions">${button('记录一条观察', 'evidence', 'outlined')}${e.status !== 'closed' ? button('记录本轮结论', 'decision', 'text-button', `data-experiment="${i}"`) : ''}</div></article>`).join('') : `<div class="empty"><h3>还没开始，也没关系。</h3><p>先挑出最不确定的一件事，而不是规划整个产品。</p>${button('让伙伴帮我缩小范围', 'ask', 'outlined', 'data-prompt="experiment"')}</div>`}
  <p class="notice">样板只演示实验草稿与记录流程。创建草稿不等于批准标准、启动 Outreach 或授权付费研究。</p>`;
}
function evidence(p) {
  return `<div class="section-head"><div><h2>留下原话，也留下反例。</h2><p class="muted">观察与解释分开。下面的初始内容全部为虚构示例。</p></div>${button('＋ 记录观察', 'evidence', 'primary')}</div>
    ${p.evidence.length ? `<div class="timeline">${p.evidence.map((e) => `<article class="evidence-item"><span class="eyebrow">${esc(e.source)}</span>${badge(stanceLabels[e.stance], e.stance === 'supports' ? 'positive' : e.stance === 'challenges' ? 'warm' : '')}<blockquote>“${esc(e.quote)}”</blockquote><p><strong>解释，而非事实：</strong>${esc(e.interpretation || '暂不做解释。')}</p></article>`).join('')}</div>` : `<div class="empty"><h3>还没有证据。</h3><p>一段原话、一条行为记录，甚至一个反例，都是起点。</p></div>`}
    <section class="section"><div class="section-head"><h2>决策手记</h2>${button('和伙伴复盘', 'ask', 'text-button', 'data-prompt="review"')}</div>${p.decisions.length ? p.decisions.map(d => `<article class="evidence-item">${badge(d.outcome)}<p>${esc(d.reason)}</p><small>人工记录 · 不自动推进产品阶段</small></article>`).join('') : '<p class="muted">没有结论也是一种状态。不因为有了几条回复，就把需求标为成立。</p>'}</section>`;
}
const existingRoutes = [
  ['contacts', '联系人', '现有名单、渠道与匹配理由'], ['review', '审核队列', '逐人核对身份、联系渠道与文案'], ['send', '发送队列', '明确确认后发邮件；社媒手动记录'], ['sent', '发送记录', '已记录的发送，不等于送达'], ['connections', 'LinkedIn Connect', '邀请与消息记录分开'], ['crm', 'CRM 概览', '按时间与渠道查看联系记录'], ['templates', '消息模板', '首次联系与跟进文案'], ['automation', '现有自动化', '原有运行与限速设置，样板不改动'],
];
function outreach() {
  return `<span class="eyebrow">EXISTING WORKSPACE / 保持原样</span><section class="section"><h2>Outreach 已经有实现，不在这里重做。</h2><p class="muted">产品实验室先验证信息架构。现有 Cold Reach 的联系人、审核、发送和历史记录继续留在原工作区。</p></section>
    <p class="notice">当前旧工作区仍以 Jarvis 数据为主，尚未与这里的演示产品关联。本页不读取真实联系人，也不显示编造的外联数量。</p>
    <div class="route-grid">${existingRoutes.map(([view, title, note]) => `<button data-action="existing" data-route="${view}"><strong>${title} ↗</strong><small>${note}</small></button>`).join('')}</div>
    <section class="section"><h3>未来接入后，这里应该回答</h3><div class="table-wrap"><table><thead><tr><th>联系谁</th><th>联系进展</th><th>发送结果</th><th>下一步</th></tr></thead><tbody><tr><td colspan="4" class="muted">尚未接入本产品的联系记录。审核、发送、回复与实验结论不会混成一个状态。</td></tr></tbody></table></div></section>`;
}
function allProjects() {
  const drafts = projects.reduce((n, p) => n + p.experiments.filter(e => e.status === 'draft').length, 0);
  return `${heading('少一点猜测，多一点证据。', '把注意力留给当前的问题，而不是又多了多少个想法。', button('＋ 记录想法', 'capture', 'primary'))}
    <section class="question section"><span class="eyebrow">NEXT / 值得你看一眼</span><h2>${drafts ? `${drafts} 个实验草案，等待你决定怎么验证。` : '先选一个你真正好奇的问题。'}</h2><p>这里不把未回复当作失败，也不把点击量当作需求。</p>${drafts ? `<div class="question-foot">${button('查看实验草案 →', 'first-experiment', 'text-button')}</div>` : ''}</section>
    <section class="section"><div class="section-head"><h2>正在探索</h2><small>${projects.length} 个演示产品</small></div>${projects.map(p => `<button class="project-row" data-page="${p.id}"><div><strong>${esc(p.name)}</strong><p>${esc(p.question)}</p><p>${p.experiments.length} 个实验 · ${p.evidence.length} 条观察</p></div><span aria-hidden="true">↗</span></button>`).join('')}</section>`;
}
function inboxView() {
  return `${heading('先留下，不急着做。', '一句话就够。值得继续的念头，再进入一个产品工作区。', button('＋ 记录想法', 'capture', 'primary'))}
    ${inbox.length ? inbox.map(i => `<article class="inbox-item"><span class="eyebrow">SPARK / 尚未开始验证</span><h3>${esc(i.name)}</h3><p>${esc(i.note)}</p>${button('开始探索 →', 'promote', 'text-button', `data-id="${i.id}"`)}</article>`).join('') : '<div class="empty"><h3>收件箱空了。</h3><p>不需要为了填满它，再想一个产品。</p></div>'}`;
}
function references() {
  return `${heading('工具在手边，不占据中心。', '保留已有目录、产品全景图和工作区；这里不迁移真实数据。')}
    <div class="route-grid">${[['discover', '机会研究', '从公开产品寻找切口'], ['map', '产品全景图', '实现、收费、上线与维护']].map(([view, title, note]) => `<button data-action="reference" data-route="${view}"><strong>${title} ↗</strong><small>${note}</small></button>`).join('')}</div>
    <section class="section"><h2>已核对的实现边界</h2><div class="timeline"><article class="evidence-item"><h3>新市场验证</h3><p>已实现产品描述、AI 草案讨论、候选人群、人工批准标准、观察与反例、结论和版本历史。</p></article><article class="evidence-item"><h3>原有 Cold Reach</h3><p>已有联系人、审核／发送队列、邮件发送、社媒手动记录、Connect、模板与 CRM 概览；当前仍以 Jarvis 为主。</p></article><article class="evidence-item"><h3>完整 PRODUCT.md 是目标，不是已交付清单</h3><p>新验证工作区尚未接通完整多产品 Outreach。本次仅制作样板，不改变发送、授权或存储逻辑。</p></article></div></section>`;
}
function main() {
  if (state.page === 'all') return allProjects();
  if (state.page === 'inbox') return inboxView();
  if (state.page === 'references') return references();
  const p = project();
  return `<div class="breadcrumb">${button('实验室', 'all')}<span aria-hidden="true">/</span><span>正在探索</span><span>·</span>${badge('演示产品')}</div>
    ${heading(p.name, p.summary, button('打开伙伴', 'partner', 'outlined partner-open-button'))}
    <nav class="tabs" aria-label="产品视图">${Object.entries(labels).map(([id, name]) => `<button data-view="${id}" ${state.view === id ? 'aria-current="page"' : ''}>${name}</button>`).join('')}</nav>
    ${{ overview, experiments, outreach, evidence }[state.view](p)}`;
}
function partner() {
  const p = project(); const key = p?.id ?? 'all'; const messages = state.chats[key] ?? [];
  return `<header class="partner-head"><h2>Brainstorm 伙伴</h2>${button('×', 'close-partner', '', 'aria-label="收起伙伴"')}</header>
    <div class="partner-context"><span>正在一起思考</span><strong>${esc(p?.name ?? '还没成形的想法')}</strong><span>脚本演示 · 未调用模型</span></div>
    <p class="partner-intro">先问对问题，<br>再急着找答案。</p><p class="explain">我会帮你找反例、缩小实验，把对话变成可检查的假设。决定仍由你来做。</p>
    <div class="prompt-list">${[['challenge', '挑战这个假设'], ['experiment', '把实验再缩小一点'], ['review', '一起复盘证据']].map(([id, name]) => button(`${name}<span aria-hidden="true">↗</span>`, 'ask', '', `data-prompt="${id}"`)).join('')}</div>
    <div class="chat-thread">${messages.map(m => `<div class="chat-message ${m.role}"><span class="eyebrow">${m.role === 'user' ? '你' : '伙伴 / 预设示例'}</span><p>${esc(m.text)}</p></div>`).join('')}</div>
    ${state.suggestions[key] ? `<section class="suggestion"><span class="eyebrow">待采纳 · ${state.suggestions[key].kind === 'experiment' ? '实验草稿' : '假设'}</span><strong>${esc(state.suggestions[key].text)}</strong>${button('预览并采纳', 'adopt', 'text-button')}</section>` : ''}
    <form class="chat-form" id="chat-form"><label for="chat-input">你在犹豫什么？</label><textarea id="chat-input" rows="3" maxlength="2000" placeholder="比如：这是不是一个伪需求？">${esc(state.chatDrafts[key] ?? '')}</textarea><footer><small>仅模拟交互，不发送</small><button type="submit">讨论 →</button></footer></form><p class="partner-note">建议需确认后才加入样板。不会改原有想法，也不会启动 Outreach。</p>`;
}
function render(focus = false) {
  document.documentElement.dataset.layout = state.layout;
  workspace.classList.toggle('partner-closed', !state.partnerOpen);
  workspace.classList.toggle('mobile-partner', state.mobilePartner);
  workspace.classList.toggle('nav-open', state.navOpen);
  $('#navigation').innerHTML = navigation(); $('#main').innerHTML = main(); $('#partner').innerHTML = partner();
  document.querySelectorAll('[data-layout]').forEach(el => { if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(el.dataset.layout === state.layout)); });
  $('.mobile-tools [data-action="navigation"]').setAttribute('aria-expanded', String(state.navOpen));
  const partnerButton = $('.mobile-tools [data-action="partner"]');
  partnerButton.setAttribute('aria-expanded', String(state.mobilePartner)); partnerButton.textContent = state.mobilePartner ? '返回工作区' : 'Brainstorm 伙伴';
  if (focus) { $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
function openPartner() { state.partnerOpen = true; state.mobilePartner = true; state.navOpen = false; render(); $('#chat-input').focus({ preventScroll: true }); $('#partner').scrollIntoView({ block: 'start' }); }
function ask(kind, text) {
  const p = project(); const key = p?.id ?? 'all'; const subject = p?.name ?? '这个想法';
  const prompts = { challenge: '挑战这个假设', experiment: '把实验再缩小一点', review: '一起复盘证据' };
  const responses = {
    challenge: `先不替「${subject}」证明自己。最近一次出现这个问题是什么时候？对方付出了什么实际代价？如果现有模板就能解决，我们还剩下什么价值？`,
    experiment: `先不做完整产品。对「${subject}」，可以先还原一次真实任务，观察卡住的步骤，再决定需不需要原型。下面只是演示提案，样本与标准需要你调整。`,
    review: `先把原话和推断分开。「${subject}」目前在样板里有 ${p?.evidence.length ?? 0} 条观察。哪些反例会改变决定？缺少信息时，应记录证据不足，而不是勉强通过。`,
  };
  state.chats[key] ??= []; state.chats[key].push({ role: 'user', text: text || prompts[kind] }, { role: 'assistant', text: text ? `这是一条预设演示回复，不会分析或上传你的输入。可以先从三个问题展开：谁最近遇到过？他们目前怎么解决？什么观察会让你放弃这个想法？` : responses[kind] });
  if (p) state.suggestions[key] = { kind: kind === 'experiment' ? 'experiment' : 'hypothesis', text: kind === 'experiment' ? '先做一次任务回放，不做完整原型' : `对「${subject}」：现有替代方案可能已经足够，先寻找无法满足的具体场景。` };
  state.chatDrafts[key] = ''; state.partnerOpen = true; state.mobilePartner = true; render();
  $('#partner .chat-thread').scrollIntoView({ block: 'nearest' }); notify('已展示预设讨论示例，未调用 AI');
}
function field(label, name, value = '', type = 'textarea', required = true) {
  const id = `modal-field-${name}`;
  return `<div class="form-field"><label for="${id}">${esc(label)}</label>${type === 'input' ? `<input id="${id}" name="${name}" value="${esc(value)}" maxlength="160" ${required ? 'required' : ''}>` : `<textarea id="${id}" name="${name}" rows="3" maxlength="4000" ${required ? 'required' : ''}>${esc(value)}</textarea>`}</div>`;
}
function openModal(title, content, submitText, onSubmit) {
  modalOpener = document.activeElement; modalSubmit = onSubmit;
  $('#modal-title').textContent = title; $('#modal-content').innerHTML = content;
  $('#modal-actions').innerHTML = `${button('取消', 'close-modal', 'outlined')}${submitText ? `<button type="submit" class="primary">${esc(submitText)}</button>` : ''}`;
  $('#modal').showModal();
  ($('#modal-content input, #modal-content textarea, #modal-content select') ?? $('#modal [data-action="close-modal"]')).focus();
}
$('#modal').addEventListener('close', () => { modalSubmit = null; if (modalOpener?.isConnected) modalOpener.focus(); else $('#main').focus({ preventScroll: true }); });
$('#modal-form').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const data = Object.fromEntries(new FormData(form)); if (Object.values(data).some(v => typeof v === 'string' && v.length > 4000)) return; const run = modalSubmit; if (run && run(data) !== false) $('#modal').close(); });
function capture() { openModal('先留住一个念头。', `<p class="muted">先放到想法收件箱，不创建实验或启动外联。仅当前页面有效。</p>${field('给它一个名字', 'name', '', 'input')}${field('你看到了什么问题？', 'note', '', 'textarea', false)}`, '放入想法收件箱', data => { if (!data.name.trim()) return false; inbox.unshift({ id: `spark-${crypto.randomUUID()}`, name: data.name.trim(), note: data.note }); navigate('inbox'); notify('已加入样板收件箱 · 刷新重置'); }); }
function newExperiment(suggestion) { const p = project(); if (!p) return notify('先从左侧选择一个演示产品'); openModal('设计一次小实验', `<p class="muted">这是一份草稿，不代表批准、开跑或发送。</p>${field('实验名称', 'title', suggestion ?? '', 'input')}${field('要验证的假设', 'hypothesis', p.hypotheses[0]?.text ?? '')}${field('找谁、怎样观察', 'method')}${field('什么结果会改变决定？', 'criteria')}`, '加入实验草稿', data => { if (Object.values(data).some(v => !v.trim())) return false; p.experiments.push({ ...data, status: 'draft' }); delete state.suggestions[p.id]; navigate(p.id, 'experiments'); notify('已加入演示实验草稿，未批准或启动'); }); }
function observation() { const p = project(); if (!p) return; openModal('记录观察，而不是润色结论。', `${field('来源 / 访谈标识', 'source', '', 'input')}${field('原话或实际观察', 'quote')}<label><span>与假设的关系</span><select name="stance"><option value="unknown">尚不明确</option><option value="supports">支持线索</option><option value="challenges">反例</option></select></label>${field('你的解释（可选）', 'interpretation', '', 'textarea', false)}`, '加入演示证据', data => { if (!data.source.trim() || !data.quote.trim()) return false; p.evidence.push(data); navigate(p.id, 'evidence'); notify('观察已加入样板，未写入真实产品'); }); }
function existing(view) { const route = existingRoutes.find(r => r[0] === view); if (!route) return; openModal('即将打开原有 Outreach', `<p>这是现有的真实工作区，不是样板。当前以 Jarvis 数据为主，不会带入演示产品或联系人。</p><p class="muted">本次只保留入口。打开后仍按原有审核、授权与发送规则操作。</p><a href="/outreach/research?view=${view}" target="_blank" rel="noopener">在新标签页打开「${esc(route[1])}」 ↗</a>`, '', null); }
document.addEventListener('input', event => {
  if (event.target.id === 'project-note' && project()) { project().note = event.target.value; $('#note-status').textContent = '已暂存于当前样板 · 刷新重置'; }
  if (event.target.id === 'chat-input') state.chatDrafts[project()?.id ?? 'all'] = event.target.value;
});
document.addEventListener('submit', event => { if (event.target.id !== 'chat-form') return; event.preventDefault(); const text = $('#chat-input').value.trim(); if (text) { ask('challenge', text); $('#chat-input').focus({ preventScroll: true }); } });
document.addEventListener('click', event => {
  if (event.target.closest('.skip')) { event.preventDefault(); $('#main').focus(); return; }
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.page) return navigate(target.dataset.page);
  if (target.dataset.view) return navigate(state.page, target.dataset.view);
  if (target.dataset.layout) { state.layout = target.dataset.layout; history.pushState(null, '', `#${new URLSearchParams({ project: state.page, view: state.view, layout: state.layout })}`); render(); return; }
  const p = project();
  switch (target.dataset.action) {
    case 'all': return navigate('all');
    case 'view-experiments': return navigate(state.page, 'experiments');
    case 'first-experiment': { const found = projects.find(p => p.experiments.some(e => e.status === 'draft')); if (found) navigate(found.id, 'experiments'); return; }
    case 'capture': return capture();
    case 'promote': { const i = inbox.findIndex(i => i.id === target.dataset.id); if (i < 0) return; const idea = inbox.splice(i, 1)[0]; projects.push({ ...idea, id: `project-${crypto.randomUUID()}`, summary: '从一个问题开始，不急着做完整产品。', audience: '还需要一起界定', alternative: '还没有记录', question: '谁最近真的遇到了这个问题？', hypotheses: [], experiments: [], evidence: [], decisions: [] }); navigate(projects.at(-1).id); notify('已开始探索 · 没有创建实验或发送消息'); return; }
    case 'navigation': state.navOpen = !state.navOpen; state.mobilePartner = false; render(); return;
    case 'partner': if (state.mobilePartner && matchMedia('(max-width:800px)').matches) { state.mobilePartner = false; render(true); } else openPartner(); return;
    case 'close-partner': state.partnerOpen = false; state.mobilePartner = false; render(); ($('.mobile-tools [data-action="partner"]').getClientRects().length ? $('.mobile-tools [data-action="partner"]') : $('#main .partner-open-button') ?? $('#main')).focus({ preventScroll: true }); return;
    case 'ask': return ask(target.dataset.prompt ?? 'challenge');
    case 'experiment': return newExperiment();
    case 'evidence': return observation();
    case 'hypothesis': if (p) openModal('补充一个可被推翻的假设', field('假设', 'text'), '加入假设', data => { if (!data.text.trim()) return false; p.hypotheses.push({ text: data.text.trim(), detail: '人工补充 · 尚未验证' }); render(); notify('已加入演示假设'); }); return;
    case 'adopt': { const suggestion = state.suggestions[p?.id]; if (!suggestion) return; if (suggestion.kind === 'experiment') return newExperiment(suggestion.text); openModal('先看一眼，再采纳。', `<p class="muted">只会加入「${esc(p.name)}」的演示假设，不覆盖笔记，也不会推进阶段。</p>${field('假设内容', 'text', suggestion.text)}`, '确认加入假设', data => { if (!data.text.trim()) return false; p.hypotheses.push({ text: data.text.trim(), detail: '采纳自样板讨论 · 待验证' }); delete state.suggestions[p.id]; navigate(p.id); notify('已采纳到样板，原有产品未改变'); }); return; }
    case 'decision': { const e = p?.experiments[Number(target.dataset.experiment)]; if (!e) return; openModal('本轮学到了什么？', `<p class="muted">实验：${esc(e.title)}。不会自动开始下一阶段。</p><label><span>你的判断</span><select name="outcome"><option>证据不足</option><option>调整方向</option><option>值得继续</option><option>暂时停止</option></select></label>${field('依据、反例与下一步', 'reason')}`, '记录演示结论', data => { if (!data.reason.trim()) return false; p.decisions.push(data); e.status = 'closed'; navigate(p.id, 'evidence'); notify('已记录演示结论，产品阶段没有自动变化'); }); return; }
    case 'existing': return existing(target.dataset.route);
    case 'reference': { const view = target.dataset.route; if (!['discover', 'map'].includes(view)) return; openModal('打开现有参考工具', `<p>将在新标签页打开真实产品工作区，不会转移样板中的编辑。</p><a href="/product?view=${view}" target="_blank" rel="noopener">打开${view === 'map' ? '产品全景图' : '机会研究'} ↗</a>`, '', null); return; }
    case 'theme': { const dark = document.documentElement.dataset.theme === 'dark'; document.documentElement.dataset.theme = dark ? 'light' : 'dark'; target.textContent = dark ? '深色外观' : '浅色外观'; return; }
    case 'close-modal': return $('#modal').close();
    case 'reset': return openModal('重置这个样板？', '<p>仅清除这次页面里的演示修改，真实想法和 Outreach 完全不受影响。</p>', '重置演示内容', () => { location.reload(); });
  }
});
readLocation(); render();
