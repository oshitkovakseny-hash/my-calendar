import { useEffect, useMemo, useState } from "react";
import {
  AGE_GROUPS,
  QUESTIONS_BY_AGE,
  REFLECTION_QUESTIONS,
  DISCLAIMER,
} from "./data/questions.js";
import { computeResult } from "./logic/scoring.js";
import { buildResultEmailHtml } from "./logic/emailTemplate.js";
import { saveSubmission, queueResultEmail } from "./firebase.js";

// Не даёт медленной или недоступной сети держать пользователя на экране
// «Отправляем…» бесконечно — после ms результат всё равно показывается.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

const C = {
  bg: "#F4F8FA",
  card: "#FFFFFF",
  ink: "#24333D",
  sub: "#5B6B76",
  faint: "#8A97A0",
  brand: "#245B78",
  accentBg: "#EAF2F6",
  green: "#2F6B57",
  border: "rgba(36,51,61,0.10)",
  warnBg: "#FCEFEA",
  warnText: "#8A4B2E",
};

const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif`;

// Шаги: start -> age -> instructions -> q0..q6 -> email -> result
function stepsForAge() {
  return ["start", "age", "instructions", ...Array.from({ length: 7 }, (_, i) => `q${i}`), "email", "result"];
}

function hashToStep() {
  const h = window.location.hash.replace("#", "");
  return h || "start";
}

export default function App() {
  const [step, setStep] = useState(hashToStep());
  const [ageId, setAgeId] = useState(null);
  const [answers, setAnswers] = useState({}); // { "4-6": [scores...] } keyed by age for safety on back nav
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const onHash = () => setStep(hashToStep());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function goTo(next) {
    window.location.hash = next;
    setStep(next);
  }

  const questions = ageId ? QUESTIONS_BY_AGE[ageId] : null;
  const currentAnswers = ageId ? answers[ageId] || [] : [];

  const order = useMemo(() => stepsForAge(), []);
  const stepIndex = order.indexOf(step);
  const totalSteps = order.length - 1; // без учёта стартового экрана
  const progress = step === "start" ? 0 : Math.min(1, Math.max(0, stepIndex / (order.length - 2)));

  function selectAge(id) {
    setAgeId(id);
    setAnswers(prev => ({ ...prev, [id]: prev[id] || Array(7).fill(null) }));
    goTo("instructions");
  }

  function answerQuestion(qIndex, score) {
    setAnswers(prev => {
      const arr = [...(prev[ageId] || Array(7).fill(null))];
      arr[qIndex] = score;
      return { ...prev, [ageId]: arr };
    });
  }

  function nextFromQuestion(qIndex) {
    if (qIndex === 6) goTo("email");
    else goTo(`q${qIndex + 1}`);
  }

  const result = useMemo(() => {
    if (!ageId) return null;
    const arr = answers[ageId];
    if (!arr || arr.some(v => v == null)) return null;
    return computeResult(arr);
  }, [ageId, answers]);

  async function submitEmail(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("Проверьте, пожалуйста, адрес почты.");
      return;
    }
    setEmailError("");
    setSending(true);
    setSendError("");
    try {
      const ageLabel = AGE_GROUPS.find(g => g.id === ageId)?.label || ageId;
      const r = computeResult(answers[ageId]);
      await withTimeout(
        saveSubmission({
          email: trimmed,
          ageGroup: ageId,
          answers: answers[ageId],
          total: r.total,
          levelTitle: r.level.title,
        }),
        8000
      );
      const html = buildResultEmailHtml({ ageLabel, ...r });
      await withTimeout(
        queueResultEmail({
          to: trimmed,
          subject: "Расшифровка теста: образовательная стратегия вашего ребёнка",
          html,
        }),
        8000
      );
      setSent(true);
    } catch (err) {
      console.warn("Не удалось отправить результат:", err);
      setSendError("Не получилось отправить письмо, но результат уже готов ниже.");
    } finally {
      setSending(false);
      goTo("result");
    }
  }

  function restart() {
    setAgeId(null);
    setAnswers({});
    setEmail("");
    setEmailError("");
    setSendError("");
    setSent(false);
    goTo("start");
  }

  return (
    <div style={{ minHeight: "100%", background: C.bg, fontFamily: FONT, color: C.ink }}>
      {step !== "start" && (
        <div style={{ position: "sticky", top: 0, height: 4, background: C.border, zIndex: 5 }}>
          <div
            style={{
              height: "100%",
              width: `${progress * 100}%`,
              background: C.brand,
              transition: "width .25s ease",
            }}
          />
        </div>
      )}

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 20px 56px" }}>
        {step === "start" && <StartScreen onStart={() => goTo("age")} />}

        {step === "age" && <AgeScreen onSelect={selectAge} />}

        {step === "instructions" && (
          <InstructionsScreen onNext={() => goTo("q0")} onBack={() => goTo("age")} />
        )}

        {step.startsWith("q") && questions && (
          <QuestionScreen
            index={Number(step.slice(1))}
            total={7}
            question={questions[Number(step.slice(1))]}
            selected={currentAnswers[Number(step.slice(1))]}
            onAnswer={score => answerQuestion(Number(step.slice(1)), score)}
            onNext={() => nextFromQuestion(Number(step.slice(1)))}
            onBack={() => {
              const i = Number(step.slice(1));
              goTo(i === 0 ? "instructions" : `q${i - 1}`);
            }}
          />
        )}

        {step === "email" && (
          <EmailScreen
            email={email}
            setEmail={setEmail}
            error={emailError}
            sending={sending}
            onSubmit={submitEmail}
            onBack={() => goTo("q6")}
          />
        )}

        {step === "result" && result && (
          <ResultScreen
            ageLabel={AGE_GROUPS.find(g => g.id === ageId)?.label || ""}
            result={result}
            email={email}
            sent={sent}
            sendError={sendError}
            onRestart={restart}
          />
        )}
      </div>
    </div>
  );
}

function Card({ children }) {
  return (
    <div
      style={{
        background: C.card,
        borderRadius: 20,
        padding: "28px 24px",
        boxShadow: "0 1px 3px rgba(36,51,61,0.06), 0 8px 24px rgba(36,51,61,0.05)",
        border: `1px solid ${C.border}`,
      }}
    >
      {children}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, type = "button" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "14px 20px",
        borderRadius: 14,
        border: "none",
        background: disabled ? "#A9C0CC" : C.brand,
        color: "#fff",
        fontSize: 16,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        fontFamily: FONT,
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 4px",
        border: "none",
        background: "transparent",
        color: C.sub,
        fontSize: 15,
        cursor: "pointer",
        fontFamily: FONT,
      }}
    >
      {children}
    </button>
  );
}

function StartScreen({ onStart }) {
  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.green, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 10 }}>
        Тест для родителей · 4–18 лет
      </div>
      <h1 style={{ fontSize: 26, lineHeight: 1.25, margin: "0 0 12px", color: C.brand }}>
        Насколько продумана образовательная стратегия вашего ребёнка?
      </h1>
      <p style={{ fontSize: 16, lineHeight: 1.55, color: C.sub, margin: "0 0 20px" }}>
        Пройдите короткий тест и узнайте, насколько образовательная стратегия вашего ребёнка
        соответствует его возрасту, поддерживает самостоятельность и интерес и сохраняет баланс
        нагрузки.
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 24, fontSize: 14, color: C.sub }}>
        <span>📋 7 вопросов</span>
        <span>⏱ 3–5 минут</span>
        <span>✉️ расшифровка на почту</span>
      </div>
      <PrimaryButton onClick={onStart}>Начать тест</PrimaryButton>
      <p style={{ fontSize: 12, color: C.faint, marginTop: 16, lineHeight: 1.5 }}>{DISCLAIMER}</p>
    </Card>
  );
}

function AgeScreen({ onSelect }) {
  return (
    <Card>
      <StepLabel>Шаг 1 из 2 · Возраст</StepLabel>
      <h2 style={{ fontSize: 21, margin: "8px 0 18px" }}>Сколько лет вашему ребёнку?</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {AGE_GROUPS.map(g => (
          <button
            key={g.id}
            onClick={() => onSelect(g.id)}
            style={{
              textAlign: "left",
              padding: "16px 18px",
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              background: C.accentBg,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: C.brand }}>{g.label}</div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>{g.hint}</div>
          </button>
        ))}
      </div>
      <p style={{ fontSize: 13, color: C.faint, marginTop: 16, lineHeight: 1.5 }}>
        Если ребёнок находится на границе диапазонов, выберите блок, который лучше соответствует
        текущему этапу развития.
      </p>
    </Card>
  );
}

function InstructionsScreen({ onNext, onBack }) {
  return (
    <Card>
      <StepLabel>Шаг 2 из 2 · Как отвечать</StepLabel>
      <h2 style={{ fontSize: 21, margin: "8px 0 14px" }}>Прежде чем начать</h2>
      <p style={{ fontSize: 16, lineHeight: 1.55, color: C.sub, margin: "0 0 24px" }}>
        Отвечайте, ориентируясь на последние 2–3 месяца, а не на единичные удачные или сложные
        ситуации. Выберите вариант, который точнее всего описывает вашу семейную практику.
      </p>
      <PrimaryButton onClick={onNext}>Дальше</PrimaryButton>
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <GhostButton onClick={onBack}>Назад</GhostButton>
      </div>
    </Card>
  );
}

function QuestionScreen({ index, total, question, selected, onAnswer, onNext, onBack }) {
  return (
    <Card>
      <StepLabel>Вопрос {index + 1} из {total}</StepLabel>
      <h2 style={{ fontSize: 20, lineHeight: 1.4, margin: "8px 0 4px", color: C.brand }}>
        {question.title}
      </h2>
      <p style={{ fontSize: 16, lineHeight: 1.5, color: C.ink, margin: "0 0 18px" }}>
        {question.text}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
        {question.options.map(opt => {
          const isSelected = selected === opt.score;
          return (
            <button
              key={opt.letter}
              onClick={() => onAnswer(opt.score)}
              style={{
                textAlign: "left",
                padding: "14px 16px",
                borderRadius: 14,
                border: `1.5px solid ${isSelected ? C.brand : C.border}`,
                background: isSelected ? C.accentBg : "#fff",
                cursor: "pointer",
                fontFamily: FONT,
                fontSize: 15,
                lineHeight: 1.45,
                color: C.ink,
              }}
            >
              {opt.text}
            </button>
          );
        })}
      </div>
      <PrimaryButton onClick={onNext} disabled={selected == null}>
        {index === total - 1 ? "Завершить" : "Дальше"}
      </PrimaryButton>
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <GhostButton onClick={onBack}>Назад</GhostButton>
      </div>
    </Card>
  );
}

function EmailScreen({ email, setEmail, error, sending, onSubmit, onBack }) {
  return (
    <Card>
      <StepLabel>Последний шаг</StepLabel>
      <h2 style={{ fontSize: 21, margin: "8px 0 12px" }}>Куда отправить расшифровку?</h2>
      <p style={{ fontSize: 15, lineHeight: 1.5, color: C.sub, margin: "0 0 20px" }}>
        Укажите почту — мы пришлём туда подробную расшифровку результата и рекомендации.
      </p>
      <form onSubmit={onSubmit}>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: 14,
            border: `1.5px solid ${error ? "#D9503A" : C.border}`,
            fontSize: 16,
            fontFamily: FONT,
            marginBottom: 8,
            boxSizing: "border-box",
          }}
        />
        {error && <p style={{ color: "#D9503A", fontSize: 13, margin: "0 0 12px" }}>{error}</p>}
        <div style={{ height: error ? 8 : 20 }} />
        <PrimaryButton type="submit" disabled={sending}>
          {sending ? "Отправляем…" : "Получить расшифровку"}
        </PrimaryButton>
      </form>
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <GhostButton onClick={onBack}>Назад</GhostButton>
      </div>
    </Card>
  );
}

function ResultScreen({ ageLabel, result, email, sent, sendError, onRestart }) {
  const { total, level, recommendations, priorityNote } = result;
  return (
    <Card>
      <StepLabel>Результат</StepLabel>
      <h2 style={{ fontSize: 22, margin: "8px 0 4px", color: C.brand }}>{level.title}</h2>
      <p style={{ fontSize: 14, color: C.sub, margin: "0 0 18px" }}>
        {ageLabel} · {total} из 21 балла
      </p>

      {sendError ? (
        <Banner tone="warn">{sendError}</Banner>
      ) : (
        <Banner tone="ok">Мы отправили полную расшифровку на {email || "вашу почту"}.</Banner>
      )}

      <p style={{ fontSize: 16, lineHeight: 1.55, margin: "18px 0" }}>{level.text}</p>

      {priorityNote && <Banner tone="warn">{priorityNote}</Banner>}

      {recommendations.length > 0 && (
        <>
          <SectionTitle>На что обратить внимание в первую очередь</SectionTitle>
          <ul style={{ paddingLeft: 20, margin: "0 0 20px", lineHeight: 1.55 }}>
            {recommendations.map((r, i) => (
              <li key={i} style={{ marginBottom: 8 }}>{r}</li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle>Вопросы для размышления</SectionTitle>
      <ul style={{ paddingLeft: 20, margin: "0 0 24px", lineHeight: 1.55 }}>
        {REFLECTION_QUESTIONS.map((q, i) => (
          <li key={i} style={{ marginBottom: 8 }}>{q}</li>
        ))}
      </ul>

      <PrimaryButton onClick={onRestart}>Пройти ещё раз</PrimaryButton>
      <p style={{ fontSize: 12, color: C.faint, marginTop: 18, lineHeight: 1.5 }}>{DISCLAIMER}</p>
    </Card>
  );
}

function Banner({ tone, children }) {
  const bg = tone === "warn" ? C.warnBg : C.accentBg;
  const color = tone === "warn" ? C.warnText : C.green;
  return (
    <div style={{ background: bg, color, borderRadius: 12, padding: "10px 14px", fontSize: 14, marginBottom: 12, lineHeight: 1.45 }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: C.brand, textTransform: "uppercase", letterSpacing: 0.3, margin: "0 0 10px" }}>
      {children}
    </div>
  );
}

function StepLabel({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: C.faint, letterSpacing: 0.3, textTransform: "uppercase" }}>{children}</div>;
}
