"use client";

import { useState } from "react";
import type { PiSubmit } from "./ai-pi-native-controls";

export type PiQuestionnaire = { version: 1; toolCallId: string; title?: string; questions: { id: string; header?: string; question: string; options?: { label: string; description?: string; recommended?: boolean }[]; allowCustom?: boolean; allowFreeform?: boolean }[] };
export type PiUiRequest = { id?: string; requestId?: string; method: string; title?: string; message?: string; options?: string[]; initialValue?: string; prefill?: string; placeholder?: string; status?: string; operationId?: string; generation?: number; toolCallId?: string; questionnaire?: PiQuestionnaire };

export default function AiPiQuestionnaire({ request, disabled, submit }: { request: PiUiRequest; disabled: boolean; submit: PiSubmit }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [freeform, setFreeform] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const questionnaire = request.questionnaire;
  if (!questionnaire) return null;
  const id = request.id ?? request.requestId ?? "";
  const complete = questionnaire.questions.every(question => !!answers[question.id]?.trim());
  const settle = async (cancelled = false) => {
    if (disabled || submitted || !cancelled && !complete) return;
    setSubmitted(true);
    const response = cancelled ? { cancelled: true } : { value: JSON.stringify({ version: 1, answers: Object.fromEntries(questionnaire.questions.map(question => [question.id, answers[question.id].trim()])) }) };
    const ok = await submit("ui_response", { requestId: id, ...response });
    // A transport-unknown request remains in the workspace intent ledger. Its
    // disabled state prevents replay; known rejection permits a fresh answer.
    if (!ok) setSubmitted(false);
  };
  return <section className="ai-pi-extension-ui ai-pi-questionnaire" role="dialog" aria-label={questionnaire.title || "补充问题"}>
    <strong>{questionnaire.title || "请补充以下问题"}</strong><p>一次提交全部答案。回答用于澄清任务，业务写入仍使用专用确认。</p>
    {questionnaire.questions.map((question, index) => <fieldset key={question.id} disabled={disabled || submitted}><legend>{index + 1}. {question.header || question.question}</legend>{question.header && <p>{question.question}</p>}{(question.options ?? []).map(option => <label className="ai-pi-question-option" key={option.label}><input type="radio" name={`${id}:${question.id}`} checked={!freeform[question.id] && answers[question.id] === option.label} onChange={() => { setFreeform(value => ({ ...value, [question.id]: false })); setAnswers(value => ({ ...value, [question.id]: option.label })); }} /><span><strong>{option.label}{option.recommended ? "（推荐）" : ""}</strong>{option.description && <small>{option.description}</small>}</span></label>)}{(question.allowCustom ?? question.allowFreeform ?? true) && <label className="ai-pi-question-option"><input type="radio" name={`${id}:${question.id}`} checked={!!freeform[question.id]} onChange={() => { setFreeform(value => ({ ...value, [question.id]: true })); setAnswers(value => ({ ...value, [question.id]: "" })); }} /><span>自由填写{freeform[question.id] && <textarea aria-label={`${question.header || question.question} 自由填写`} value={answers[question.id] ?? ""} maxLength={8000} onChange={event => setAnswers(value => ({ ...value, [question.id]: event.target.value }))} />}</span></label>}</fieldset>)}
    <div className="ai-pi-control-row"><button type="button" disabled={disabled || submitted || !complete} onClick={() => { void settle(); }}>{submitted ? "正在核实回执…" : "提交全部答案"}</button><button type="button" disabled={disabled || submitted} onClick={() => { void settle(true); }}>取消问卷</button></div>
  </section>;
}
