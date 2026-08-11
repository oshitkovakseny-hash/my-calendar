import { LEVELS, THEMATIC_NOTES, WORKLOAD_WARNING, PRIORITY_RULE_NOTE } from "../data/questions.js";

// answers: массив из 7 баллов (0–3), по одному на вопрос, в порядке вопросов 1..7.
export function computeResult(answers) {
  const total = answers.reduce((s, v) => s + v, 0);
  const level = LEVELS.find(l => total >= l.min && total <= l.max) || LEVELS[LEVELS.length - 1];

  // Порядок приоритета при равенстве баллов: сперва вопрос 7 (индекс 6),
  // затем вопрос 1 (индекс 0), затем остальные по возрастанию номера.
  const tieOrder = i => (i === 6 ? 0 : i === 0 ? 1 : i + 2);
  const order = [...answers.keys()].sort(
    (a, b) => answers[a] - answers[b] || tieOrder(a) - tieOrder(b)
  );

  const recommendations = [];
  const usedIndexes = new Set();

  if (answers[6] <= 1) {
    recommendations.push(WORKLOAD_WARNING);
    usedIndexes.add(6);
  }

  for (const i of order) {
    if (recommendations.length >= 3) break;
    if (usedIndexes.has(i)) continue;
    if (answers[i] <= 1) {
      recommendations.push(THEMATIC_NOTES[i]);
      usedIndexes.add(i);
    }
  }

  // Если слабых мест (баллы 0–1) недостаточно, добираем направлениями с
  // ответом «Б» (балл 2) — это соответствует совету для высокого уровня
  // «сделать более регулярными» такие ответы. Направления с лучшим
  // ответом «А» (балл 3) никогда не попадают в рекомендации — там нет
  // проблемы, которую стоило бы называть.
  if (recommendations.length < 2) {
    for (const i of order) {
      if (recommendations.length >= 3) break;
      if (usedIndexes.has(i)) continue;
      if (answers[i] === 2) {
        recommendations.push(THEMATIC_NOTES[i]);
        usedIndexes.add(i);
      }
    }
  }

  const hasZero = answers.some(a => a === 0);

  return {
    total,
    level,
    recommendations,
    priorityNote: hasZero ? PRIORITY_RULE_NOTE : null,
  };
}
