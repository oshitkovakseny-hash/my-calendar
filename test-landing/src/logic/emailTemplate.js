import { REFLECTION_QUESTIONS, DISCLAIMER } from "../data/questions.js";

export function buildResultEmailHtml({ ageLabel, total, level, recommendations, priorityNote }) {
  const recItems = recommendations
    .map(r => `<li style="margin:0 0 10px;">${escapeHtml(r)}</li>`)
    .join("");
  const reflectionItems = REFLECTION_QUESTIONS
    .map(q => `<li style="margin:0 0 10px;">${escapeHtml(q)}</li>`)
    .join("");

  return `
  <div style="font-family: -apple-system, Arial, sans-serif; max-width: 560px; margin: 0 auto; color:#24333D;">
    <h1 style="font-size:20px; color:#245B78; margin: 0 0 8px;">Расшифровка теста об образовательной стратегии</h1>
    <p style="margin: 0 0 16px; color:#5B6B76;">Возраст ребёнка: ${escapeHtml(ageLabel)} · Итоговый балл: ${total} из 21</p>

    <div style="background:#EAF2F6; border-radius:12px; padding:16px 18px; margin: 0 0 20px;">
      <p style="margin:0 0 6px; font-weight:bold; color:#245B78;">${escapeHtml(level.title)}</p>
      <p style="margin:0; line-height:1.5;">${escapeHtml(level.text)}</p>
    </div>

    ${priorityNote ? `<p style="margin:0 0 16px; padding:10px 14px; background:#FCEFEA; border-radius:10px; color:#8A4B2E;">${escapeHtml(priorityNote)}</p>` : ""}

    ${recommendations.length > 0 ? `
    <h2 style="font-size:16px; color:#245B78; margin: 0 0 8px;">На что обратить внимание в первую очередь</h2>
    <ul style="padding-left: 20px; margin: 0 0 20px; line-height:1.5;">${recItems}</ul>` : ""}

    <h2 style="font-size:16px; color:#245B78; margin: 0 0 8px;">Вопросы для размышления</h2>
    <ul style="padding-left: 20px; margin: 0 0 20px; line-height:1.5;">${reflectionItems}</ul>

    <p style="font-size:12px; color:#8A97A0; line-height:1.5; margin-top: 24px;">${escapeHtml(DISCLAIMER)}</p>
  </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
