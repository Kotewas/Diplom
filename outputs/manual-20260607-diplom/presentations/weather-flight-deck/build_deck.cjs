const pptxgen = require('pptxgenjs');
const path = require('path');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Смирнова Екатерина Сергеевна';
pptx.subject = 'Дипломный проект';
pptx.title = 'Информационная система мониторинга и анализа погодных условий для авиационных рейсов';
pptx.company = 'ГБПОУ «Тверской колледж им. А.Н.Коняева»';
pptx.lang = 'ru-RU';
pptx.theme = {
  headFontFace: 'Aptos Display',
  bodyFontFace: 'Aptos',
  lang: 'ru-RU',
};
pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'WIDE';
pptx.margin = 0;

const C = {
  ink: '12211F',
  muted: '5B6C68',
  bg: 'F5F8F6',
  white: 'FFFFFF',
  teal: '1B8A78',
  mint: 'CFEDE5',
  blue: '2F6BFF',
  sky: 'DDEAFF',
  amber: 'F2A93B',
  amberSoft: 'FFE7BD',
  red: 'D94C43',
  redSoft: 'F9D8D5',
  green: '42A66A',
  greenSoft: 'DFF4E7',
  navy: '17324D',
  line: 'DCE7E3',
  dark: '0E1F1B',
};

function addBg(slide, n) {
  slide.background = { color: C.bg };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: C.bg }, line: { color: C.bg } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.13, fill: { color: C.teal }, line: { color: C.teal } });
  slide.addText(String(n).padStart(2, '0'), { x: 12.15, y: 6.92, w: 0.55, h: 0.22, fontFace: 'Aptos', fontSize: 8, bold: true, color: C.muted, align: 'right', margin: 0 });
  slide.addShape(pptx.ShapeType.line, { x: 12.77, y: 7.03, w: 0.28, h: 0, line: { color: C.muted, width: 0.7 } });
  slide.addText('12', { x: 13.0, y: 6.92, w: 0.22, h: 0.22, fontFace: 'Aptos', fontSize: 8, bold: true, color: C.muted, margin: 0 });
}

function title(slide, n, t, s) {
  addBg(slide, n);
  slide.addText(t, { x: 0.55, y: 0.32, w: 7.8, h: 0.44, fontFace: 'Aptos Display', fontSize: 20, bold: true, color: C.ink, breakLine: false, margin: 0 });
  if (s) slide.addText(s, { x: 8.65, y: 0.42, w: 3.9, h: 0.25, fontSize: 8.5, color: C.muted, align: 'right', margin: 0 });
}

function pill(slide, text, x, y, w, color = C.teal, fill = C.mint) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.38, rectRadius: 0.06, fill: { color: fill }, line: { color: fill } });
  slide.addText(text, { x: x + 0.12, y: y + 0.095, w: w - 0.24, h: 0.15, fontSize: 8.3, bold: true, color, margin: 0, align: 'center' });
}

function card(slide, x, y, w, h, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.06,
    fill: { color: opts.fill || C.white, transparency: opts.transparency || 0 },
    line: { color: opts.line || C.line, width: opts.lineWidth || 1 },
    shadow: opts.shadow ? { type: 'outer', color: 'DCE7E3', opacity: 0.25, blur: 1, angle: 45, distance: 1 } : undefined,
  });
}

function bigStat(slide, stat, label, x, y, w, color = C.teal) {
  slide.addText(stat, { x, y, w, h: 0.58, fontSize: 31, bold: true, color, margin: 0, fit: 'shrink' });
  slide.addText(label, { x, y: y + 0.66, w, h: 0.46, fontSize: 10.5, color: C.muted, margin: 0, breakLine: false, fit: 'shrink' });
}

function miniIcon(slide, x, y, label, color, glyph) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y, w: 0.63, h: 0.63, fill: { color }, line: { color } });
  slide.addText(glyph, { x, y: y + 0.12, w: 0.63, h: 0.2, fontSize: 13, bold: true, color: C.white, margin: 0, align: 'center' });
  slide.addText(label, { x: x - 0.12, y: y + 0.78, w: 0.88, h: 0.36, fontSize: 8.4, bold: true, color: C.ink, align: 'center', margin: 0, fit: 'shrink' });
}

function photoSlot(slide, x, y, w, h, label, hint, accent = C.teal) {
  card(slide, x, y, w, h, { fill: 'F0F5F3', line: 'C9D9D4' });
  slide.addShape(pptx.ShapeType.rect, { x: x + 0.14, y: y + 0.14, w: w - 0.28, h: h - 0.28, fill: { color: 'E2EBE8' }, line: { color: 'D0DEDA', dash: 'dash' } });
  slide.addText('ФОТО / СКРИНШОТ', { x: x + 0.25, y: y + h / 2 - 0.24, w: w - 0.5, h: 0.22, fontSize: 8.5, bold: true, color: accent, align: 'center', margin: 0 });
  slide.addText(label, { x: x + 0.24, y: y + h - 0.72, w: w - 0.48, h: 0.22, fontSize: 9.4, bold: true, color: C.ink, align: 'center', margin: 0, fit: 'shrink' });
  slide.addText(hint, { x: x + 0.28, y: y + h - 0.45, w: w - 0.56, h: 0.28, fontSize: 7.3, color: C.muted, align: 'center', margin: 0, fit: 'shrink' });
}

function flow(slide, items, x, y, gap = 0.22) {
  const w = (11.8 - gap * (items.length - 1)) / items.length;
  items.forEach((it, i) => {
    const xi = x + i * (w + gap);
    card(slide, xi, y, w, 1.18, { fill: it.fill || C.white, line: it.line || C.line });
    slide.addText(it.k, { x: xi + 0.15, y: y + 0.16, w: w - 0.3, h: 0.18, fontSize: 8, bold: true, color: it.color || C.teal, margin: 0 });
    slide.addText(it.t, { x: xi + 0.15, y: y + 0.43, w: w - 0.3, h: 0.34, fontSize: 13, bold: true, color: C.ink, margin: 0, fit: 'shrink' });
    slide.addText(it.s, { x: xi + 0.15, y: y + 0.86, w: w - 0.3, h: 0.18, fontSize: 7.5, color: C.muted, margin: 0, fit: 'shrink' });
    if (i < items.length - 1) {
      slide.addShape(pptx.ShapeType.chevron, { x: xi + w - 0.02, y: y + 0.43, w: 0.25, h: 0.24, fill: { color: C.teal }, line: { color: C.teal } });
    }
  });
}

function addNotes(slide, lines) {
  if (typeof slide.addNotes === 'function') slide.addNotes(lines);
}

let s;

s = pptx.addSlide();
s.background = { color: C.bg };
s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: C.bg }, line: { color: C.bg } });
s.addShape(pptx.ShapeType.arc, { x: 6.4, y: 0.7, w: 5.7, h: 4.0, adjustPoint: 0.2, line: { color: C.teal, width: 4, beginArrowType: 'none', endArrowType: 'triangle' }, fill: { color: C.bg, transparency: 100 } });
s.addShape(pptx.ShapeType.ellipse, { x: 5.85, y: 3.55, w: 0.42, h: 0.42, fill: { color: C.green }, line: { color: C.white, width: 1 } });
s.addShape(pptx.ShapeType.ellipse, { x: 11.55, y: 1.23, w: 0.42, h: 0.42, fill: { color: C.red }, line: { color: C.white, width: 1 } });
miniIcon(s, 8.25, 2.45, 'ветер', C.blue, 'W');
miniIcon(s, 9.25, 3.05, 'видимость', C.teal, 'V');
miniIcon(s, 10.25, 2.5, 'осадки', C.amber, 'P');
s.addText('ДИПЛОМНЫЙ ПРОЕКТ', { x: 0.7, y: 0.55, w: 3.8, h: 0.25, fontSize: 9.5, bold: true, color: C.teal, margin: 0, charSpace: 1 });
s.addText('Разработка информационной системы мониторинга и анализа погодных условий для авиационных рейсов', { x: 0.7, y: 1.12, w: 7.05, h: 1.75, fontSize: 30, bold: true, color: C.ink, margin: 0, breakLine: false, fit: 'shrink' });
s.addText('Поддержка диспетчера: от получения метеоданных до рекомендации по рейсу', { x: 0.72, y: 3.14, w: 5.95, h: 0.42, fontSize: 13, color: C.muted, margin: 0 });
card(s, 0.72, 5.35, 5.72, 0.88, { fill: C.white, line: C.line });
s.addText('Автор: Смирнова Екатерина Сергеевна   |   Руководитель: Маслов Игорь Олегович', { x: 0.98, y: 5.67, w: 5.24, h: 0.18, fontSize: 8.8, color: C.ink, margin: 0, fit: 'shrink' });
s.addText('ГБПОУ «Тверской колледж им. А.Н.Коняева» · Тверь · 2026', { x: 0.98, y: 5.9, w: 5.2, h: 0.16, fontSize: 7.6, color: C.muted, margin: 0, fit: 'shrink' });
s.addText('01 / 12', { x: 12.05, y: 6.92, w: 0.88, h: 0.2, fontSize: 8, bold: true, color: C.muted, margin: 0, align: 'right' });
addNotes(s, ['На титульный слайд можно поставить фото самолета на фоне облаков или скриншот карты маршрута из системы.']);

s = pptx.addSlide();
title(s, 2, 'Почему это актуально', 'Погодные данные нужно быстро превратить в решение');
bigStat(s, '≈30%', 'задержек и инцидентов в гражданской авиации связывают с погодными условиями', 0.7, 1.2, 3.6, C.teal);
photoSlot(s, 4.72, 1.05, 3.4, 4.85, 'Статистика задержек', 'круговая диаграмма: погода / техника / аэропорт / прочее', C.blue);
card(s, 8.55, 1.05, 3.95, 1.2, { fill: C.white, line: C.line });
s.addText('Ручная оценка занимает время', { x: 8.85, y: 1.28, w: 3.35, h: 0.22, fontSize: 14, bold: true, color: C.ink, margin: 0 });
s.addText('Диспетчер сопоставляет рейс, маршрут и метеоданные из разных источников.', { x: 8.85, y: 1.68, w: 3.3, h: 0.26, fontSize: 9.3, color: C.muted, margin: 0, fit: 'shrink' });
card(s, 8.55, 2.48, 3.95, 1.2, { fill: C.white, line: C.line });
s.addText('Погода меняется перед вылетом', { x: 8.85, y: 2.71, w: 3.35, h: 0.22, fontSize: 14, bold: true, color: C.ink, margin: 0 });
s.addText('Особенно важны ветер, видимость, гроза, осадки и устаревшие данные.', { x: 8.85, y: 3.11, w: 3.3, h: 0.26, fontSize: 9.3, color: C.muted, margin: 0, fit: 'shrink' });
card(s, 8.55, 3.91, 3.95, 1.2, { fill: C.white, line: C.line });
s.addText('Решение должно быть объяснимым', { x: 8.85, y: 4.14, w: 3.35, h: 0.22, fontSize: 14, bold: true, color: C.ink, margin: 0 });
s.addText('Система показывает факторы риска, а не только итоговый статус.', { x: 8.85, y: 4.54, w: 3.3, h: 0.26, fontSize: 9.3, color: C.muted, margin: 0, fit: 'shrink' });
s.addText('Идея проекта: автоматизировать анализ, но оставить финальное решение за специалистом.', { x: 0.75, y: 6.22, w: 8.9, h: 0.32, fontSize: 14.5, bold: true, color: C.ink, margin: 0 });
addNotes(s, ['Можно вставить диаграмму причин задержек рейсов. Если нет точной официальной статистики, лучше подписать как иллюстративную статистику из анализа источников.']);

s = pptx.addSlide();
title(s, 3, 'Цель и задачи', 'Одна система вместо ручной сверки источников');
card(s, 0.75, 1.1, 11.85, 1.2, { fill: C.navy, line: C.navy });
s.addText('Цель', { x: 1.05, y: 1.37, w: 1.0, h: 0.2, fontSize: 9, bold: true, color: '9FE1D3', margin: 0 });
s.addText('Разработать веб-систему, которая получает метеоданные, рассчитывает риск рейса и формирует рекомендацию диспетчеру.', { x: 1.05, y: 1.68, w: 10.9, h: 0.24, fontSize: 15, bold: true, color: C.white, margin: 0, fit: 'shrink' });
const tasks = [
  ['01', 'проанализировать предметную область'],
  ['02', 'спроектировать архитектуру и БД'],
  ['03', 'реализовать backend и frontend'],
  ['04', 'интегрировать погодный API'],
  ['05', 'рассчитать риск по этапам полета'],
  ['06', 'проверить сценарии работы'],
];
tasks.forEach((it, i) => {
  const x = 0.85 + (i % 3) * 4.05;
  const y = 2.78 + Math.floor(i / 3) * 1.55;
  card(s, x, y, 3.65, 1.05, { fill: C.white, line: C.line });
  s.addText(it[0], { x: x + 0.18, y: y + 0.22, w: 0.55, h: 0.24, fontSize: 14, bold: true, color: C.teal, margin: 0 });
  s.addText(it[1], { x: x + 0.85, y: y + 0.25, w: 2.45, h: 0.31, fontSize: 12, bold: true, color: C.ink, margin: 0, fit: 'shrink' });
});
addNotes(s, ['Здесь в речи можно раскрыть задачи подробнее, но на слайде оставить только короткие действия.']);

s = pptx.addSlide();
title(s, 4, 'Что влияет на риск рейса', 'Модель учитывает совокупность факторов, а не один параметр');
photoSlot(s, 0.75, 1.15, 4.25, 4.9, 'Фото погодных условий', 'туман, снег, гроза или сильный боковой ветер у ВПП', C.teal);
const factors = [
  ['Ветер и порывы', 'особенно на взлете и посадке', C.blue, 'W'],
  ['Видимость', 'туман, снег, сильный дождь', C.teal, 'V'],
  ['Осадки', 'ухудшение ВПП и видимости', C.amber, 'P'],
  ['Гроза', 'опасные зоны на маршруте', C.red, 'S'],
  ['Обледенение', 'температура и влажность', C.navy, 'I'],
  ['Актуальность данных', 'устаревшая погода повышает риск', C.green, 'T'],
];
factors.forEach((it, i) => {
  const x = 5.35 + (i % 2) * 3.45;
  const y = 1.25 + Math.floor(i / 2) * 1.45;
  card(s, x, y, 3.1, 1.04, { fill: C.white, line: C.line });
  s.addShape(pptx.ShapeType.ellipse, { x: x + 0.16, y: y + 0.22, w: 0.52, h: 0.52, fill: { color: it[2] }, line: { color: it[2] } });
  s.addText(it[3], { x: x + 0.16, y: y + 0.35, w: 0.52, h: 0.14, fontSize: 9, bold: true, color: C.white, align: 'center', margin: 0 });
  s.addText(it[0], { x: x + 0.82, y: y + 0.2, w: 2.0, h: 0.2, fontSize: 11.5, bold: true, color: C.ink, margin: 0 });
  s.addText(it[1], { x: x + 0.82, y: y + 0.53, w: 2.1, h: 0.18, fontSize: 8.4, color: C.muted, margin: 0, fit: 'shrink' });
});
s.addText('Главное для защиты: риск растет от сочетания факторов, поэтому система считает комплексную оценку.', { x: 5.45, y: 5.88, w: 6.2, h: 0.28, fontSize: 13, bold: true, color: C.ink, margin: 0 });
addNotes(s, ['Подойдут фотографии: грозовое облако над аэропортом, туман на ВПП, снегопад у самолета, карта погодного радара.']);

s = pptx.addSlide();
title(s, 5, 'Как работает система', 'От внешней погоды к понятной рекомендации');
flow(s, [
  { k: '1', t: 'Карточка рейса', s: 'маршрут, время, тип ВС', fill: C.white },
  { k: '2', t: 'Погода', s: 'OpenWeather + справочник аэропортов', fill: C.sky, color: C.blue },
  { k: '3', t: 'Риск', s: 'вылет · маршрут · прибытие', fill: C.mint },
  { k: '4', t: 'Рекомендация', s: 'approve / delay / cancel / meteo', fill: C.amberSoft, color: C.amber },
  { k: '5', t: 'История', s: 'решение и снимок данных', fill: C.white },
], 0.75, 1.38);
photoSlot(s, 0.95, 3.15, 5.2, 2.75, 'Скриншот карточки рейса', 'форма создания рейса и итоговый риск', C.teal);
photoSlot(s, 6.65, 3.15, 5.2, 2.75, 'Скриншот карты маршрута', 'Leaflet / OpenStreetMap с точками вылета и прилета', C.blue);
addNotes(s, ['Лучше всего вставить два настоящих скриншота из приложения: карточку рейса и карту маршрута.']);

s = pptx.addSlide();
title(s, 6, 'Архитектура', 'Три контейнера и внешние источники данных');
const arch = [
  ['React SPA', 'интерфейс диспетчера и метеоролога', 1.0, 2.0, C.mint, C.teal],
  ['Spring Boot', 'REST API, бизнес-логика, расчет риска', 5.05, 2.0, C.sky, C.blue],
  ['PostgreSQL', 'рейсы, решения, история изменений', 9.1, 2.0, C.greenSoft, C.green],
];
arch.forEach(([name, desc, x, y, fill, color]) => {
  card(s, x, y, 3.15, 1.45, { fill, line: fill });
  s.addText(name, { x: x + 0.22, y: y + 0.32, w: 2.6, h: 0.24, fontSize: 17, bold: true, color, margin: 0 });
  s.addText(desc, { x: x + 0.22, y: y + 0.78, w: 2.5, h: 0.28, fontSize: 8.6, color: C.muted, margin: 0, fit: 'shrink' });
});
s.addShape(pptx.ShapeType.chevron, { x: 4.32, y: 2.55, w: 0.35, h: 0.28, fill: { color: C.teal }, line: { color: C.teal } });
s.addShape(pptx.ShapeType.chevron, { x: 8.37, y: 2.55, w: 0.35, h: 0.28, fill: { color: C.teal }, line: { color: C.teal } });
card(s, 1.2, 4.55, 4.8, 1.0, { fill: C.white, line: C.line });
s.addText('OpenWeather API', { x: 1.5, y: 4.82, w: 1.8, h: 0.2, fontSize: 13, bold: true, color: C.blue, margin: 0 });
s.addText('ветер · видимость · осадки · давление', { x: 3.3, y: 4.85, w: 2.2, h: 0.16, fontSize: 8.3, color: C.muted, margin: 0, fit: 'shrink' });
card(s, 7.15, 4.55, 4.8, 1.0, { fill: C.white, line: C.line });
s.addText('OpenStreetMap + Leaflet', { x: 7.45, y: 4.82, w: 2.45, h: 0.2, fontSize: 13, bold: true, color: C.teal, margin: 0 });
s.addText('карта маршрута и координаты', { x: 9.9, y: 4.85, w: 1.6, h: 0.16, fontSize: 8.3, color: C.muted, margin: 0, fit: 'shrink' });
pill(s, 'Docker / docker-compose', 4.86, 6.02, 3.55, C.navy, 'EAF0EE');
addNotes(s, ['Можно заменить схему на скриншот docker-compose или оставить как архитектурную схему.']);

s = pptx.addSlide();
title(s, 7, 'Алгоритм риска', '0-100 баллов, три этапа полета, четыре рекомендации');
card(s, 0.9, 1.22, 11.55, 1.0, { fill: C.white, line: C.line });
s.addText('Rитог = 0,4 · Rвылет + 0,4 · Rприбытие + 0,2 · Rмаршрут', { x: 1.2, y: 1.58, w: 10.95, h: 0.22, fontSize: 17, bold: true, color: C.ink, align: 'center', margin: 0 });
const scaleX = 1.1, scaleY = 3.0, scaleW = 10.9;
[
  [0, 0.29, C.green, 'низкий', '0-29'],
  [0.29, 0.3, C.blue, 'средний', '30-59'],
  [0.59, 0.2, C.amber, 'высокий', '60-79'],
  [0.79, 0.21, C.red, 'критический', '80-100'],
].forEach(([st, len, col, lab, nums]) => {
  s.addShape(pptx.ShapeType.rect, { x: scaleX + scaleW * st, y: scaleY, w: scaleW * len, h: 0.35, fill: { color: col }, line: { color: col } });
  s.addText(lab, { x: scaleX + scaleW * st, y: scaleY + 0.55, w: scaleW * len, h: 0.16, fontSize: 8.6, bold: true, color: col, align: 'center', margin: 0 });
  s.addText(nums, { x: scaleX + scaleW * st, y: scaleY + 0.82, w: scaleW * len, h: 0.14, fontSize: 7.5, color: C.muted, align: 'center', margin: 0 });
});
const recs = [
  ['APPROVE', 'рейс возможен', C.greenSoft, C.green],
  ['DELAY', 'лучше задержать', C.amberSoft, C.amber],
  ['CANCEL', 'выполнение нежелательно', C.redSoft, C.red],
  ['REQUEST_METEO', 'нужно уточнение', C.sky, C.blue],
];
recs.forEach((r, i) => {
  card(s, 1.0 + i * 3.0, 5.1, 2.55, 0.75, { fill: r[2], line: r[2] });
  s.addText(r[0], { x: 1.18 + i * 3.0, y: 5.28, w: 2.17, h: 0.14, fontSize: 8.2, bold: true, color: r[3], align: 'center', margin: 0, fit: 'shrink' });
  s.addText(r[1], { x: 1.18 + i * 3.0, y: 5.53, w: 2.17, h: 0.14, fontSize: 7.6, color: C.muted, align: 'center', margin: 0, fit: 'shrink' });
});
addNotes(s, ['На этом слайде не нужно читать формулы целиком. Скажи: система отдельно оценивает вылет, прибытие и маршрут, затем переводит баллы в понятную рекомендацию.']);

s = pptx.addSlide();
title(s, 8, 'Данные и трассируемость', 'Решение можно проверить после изменения рейса');
const tables = [
  ['flights', ['номер рейса', 'аэропорты', 'время', 'риск', 'решение'], 0.85, C.teal],
  ['flight_history', ['риск до / после', 'снимок погоды', 'задержка', 'комментарий'], 4.75, C.blue],
  ['airports.json', ['IATA / ICAO', 'город', 'координаты', 'тип площадки'], 8.65, C.green],
];
tables.forEach(([name, rows, x, color]) => {
  card(s, x, 1.35, 3.35, 4.05, { fill: C.white, line: C.line });
  s.addText(name, { x: x + 0.25, y: 1.72, w: 2.8, h: 0.22, fontSize: 16, bold: true, color, margin: 0 });
  rows.forEach((r, i) => {
    s.addShape(pptx.ShapeType.line, { x: x + 0.25, y: 2.28 + i * 0.58, w: 2.8, h: 0, line: { color: C.line, width: 0.8 } });
    s.addText(r, { x: x + 0.32, y: 2.43 + i * 0.58, w: 2.65, h: 0.16, fontSize: 9.3, color: C.ink, margin: 0 });
  });
});
s.addText('Что показать на защите: история изменений доказывает, что система сохраняет не только итог, но и контекст принятого решения.', { x: 1.0, y: 6.02, w: 10.8, h: 0.28, fontSize: 13, bold: true, color: C.ink, align: 'center', margin: 0 });
addNotes(s, ['Если есть скриншот таблицы истории или карточки изменения риска, лучше вставить его вместо схемы таблиц.']);

s = pptx.addSlide();
title(s, 9, 'Отказоустойчивость', 'Система продолжает сценарий даже при сбое внешнего API');
const steps = [
  ['01', 'Запрос к OpenWeather', 'координаты из справочника'],
  ['02', 'Кэш последних данных', 'если ответ временно недоступен'],
  ['03', 'Fallback-модель', 'резервный набор параметров'],
  ['04', 'Запрос метеорологу', 'уточнение METAR / TAF / грозы'],
  ['05', 'Перерасчет риска', 'новая рекомендация диспетчеру'],
];
steps.forEach((st, i) => {
  const x = 0.9 + i * 2.45;
  card(s, x, 1.65, 2.05, 2.8, { fill: i === 2 ? C.amberSoft : C.white, line: i === 2 ? C.amberSoft : C.line });
  s.addText(st[0], { x: x + 0.17, y: 1.9, w: 0.42, h: 0.2, fontSize: 11, bold: true, color: i === 2 ? C.amber : C.teal, margin: 0 });
  s.addText(st[1], { x: x + 0.17, y: 2.32, w: 1.66, h: 0.43, fontSize: 13, bold: true, color: C.ink, margin: 0, fit: 'shrink' });
  s.addText(st[2], { x: x + 0.17, y: 3.28, w: 1.66, h: 0.28, fontSize: 8.4, color: C.muted, margin: 0, fit: 'shrink' });
  if (i < steps.length - 1) s.addShape(pptx.ShapeType.chevron, { x: x + 2.03, y: 2.78, w: 0.27, h: 0.22, fill: { color: C.teal }, line: { color: C.teal } });
});
photoSlot(s, 1.0, 5.15, 5.1, 1.15, 'Скриншот ошибки / fallback', 'индикатор устаревших или резервных данных', C.amber);
photoSlot(s, 6.8, 5.15, 5.1, 1.15, 'Скриншот запроса метеорологу', 'форма уточнения погодных условий', C.blue);
addNotes(s, ['Здесь хорошо смотрятся два скриншота: уведомление о fallback и страница запроса метеорологу.']);

s = pptx.addSlide();
title(s, 10, 'Что показывает интерфейс', 'На защите лучше перейти от схем к живой системе');
photoSlot(s, 0.8, 1.15, 5.75, 2.35, 'Мониторинг рейсов', 'список, фильтры, статусы риска', C.teal);
photoSlot(s, 6.85, 1.15, 5.75, 2.35, 'Карта маршрута', 'точки аэропортов и линия маршрута', C.blue);
photoSlot(s, 0.8, 4.0, 3.65, 1.75, 'Карточка риска', 'баллы и факторы', C.amber);
photoSlot(s, 4.83, 4.0, 3.65, 1.75, 'What-if задержка', 'сравнение риска до / после', C.green);
photoSlot(s, 8.86, 4.0, 3.65, 1.75, 'Диалог с метеорологом', 'запрос и ответ', C.blue);
addNotes(s, ['Это главный слайд для фотографий. Лучше вставить реальные скриншоты интерфейса, потому что они доказывают, что система разработана.']);

s = pptx.addSlide();
title(s, 11, 'Результаты внедрения', 'Что получилось в проекте');
const results = [
  ['Секунды', 'автоматический расчет вместо ручной сверки нескольких источников'],
  ['3 этапа', 'вылет, маршрут и прибытие оцениваются отдельно'],
  ['4 сценария', 'создание рейса, риск, fallback, взаимодействие с метеорологом'],
  ['PASS', 'функциональные сценарии проверки выполнены успешно'],
];
results.forEach((r, i) => {
  const x = 0.9 + i * 3.05;
  card(s, x, 1.55, 2.55, 2.2, { fill: i === 3 ? C.greenSoft : C.white, line: i === 3 ? C.greenSoft : C.line });
  s.addText(r[0], { x: x + 0.22, y: 2.02, w: 2.05, h: 0.38, fontSize: 24, bold: true, color: i === 3 ? C.green : C.teal, align: 'center', margin: 0, fit: 'shrink' });
  s.addText(r[1], { x: x + 0.27, y: 2.72, w: 1.96, h: 0.42, fontSize: 8.4, color: C.muted, align: 'center', margin: 0, fit: 'shrink' });
});
photoSlot(s, 1.15, 4.48, 4.9, 1.45, 'Статистика тестирования', 'таблица/диаграмма: сценарии PASS', C.green);
photoSlot(s, 7.15, 4.48, 4.9, 1.45, 'Сравнение “до/после”', 'ручная оценка vs автоматический расчет', C.teal);
addNotes(s, ['Для статистики можно сделать простую диаграмму: все ключевые сценарии тестирования со статусом PASS.']);

s = pptx.addSlide();
title(s, 12, 'Демонстрация системы', 'Переход к практическому сценарию');
card(s, 0.85, 1.32, 5.25, 4.65, { fill: C.navy, line: C.navy });
s.addText('Показываю полный сценарий', { x: 1.25, y: 1.82, w: 4.4, h: 0.4, fontSize: 24, bold: true, color: C.white, margin: 0, fit: 'shrink' });
['создание рейса', 'расчет риска', 'карта маршрута', 'запрос метеорологу', 'моделирование задержки'].forEach((t, i) => {
  s.addText(`${i + 1}. ${t}`, { x: 1.38, y: 2.75 + i * 0.45, w: 3.8, h: 0.18, fontSize: 12.5, color: C.white, margin: 0 });
});
photoSlot(s, 6.75, 1.3, 5.55, 4.65, 'Финальный скриншот системы', 'лучше поставить главный экран мониторинга', C.teal);
s.addText('Спасибо за внимание', { x: 0.98, y: 6.45, w: 3.2, h: 0.25, fontSize: 17, bold: true, color: C.ink, margin: 0 });
s.addText('Готова ответить на вопросы по архитектуре, алгоритму риска и пользовательским сценариям.', { x: 4.25, y: 6.51, w: 7.2, h: 0.16, fontSize: 8.9, color: C.muted, margin: 0 });
addNotes(s, ['Финальный слайд можно оставить перед демонстрацией приложения.']);

const out = path.resolve(__dirname, 'output', 'Презентация_по_диплому_визуальная.pptx');
pptx.writeFile({ fileName: out });
