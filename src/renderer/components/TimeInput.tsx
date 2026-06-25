import React from 'react';

// Campo de hora HH:MM em TEXTO controlado. Substitui o <input type="time">
// nativo, que no WKWebView (macOS) não reflete de forma confiável as mudanças
// controladas pelo React (a Saída 2 auto-calculada só "aparecia" no 2º evento,
// e às vezes só a 1ª linha respondia). Um input de texto controlado funciona
// de forma 100% confiável no WKWebView.

/** Formata a entrada do usuário como HH:MM (o ':' entra sozinho após 2 dígitos). */
export const maskTime = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
};

/** Verdadeiro quando `v` é um horário completo e válido (00:00–23:59). */
export const isCompleteTime = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

interface TimeInputProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  placeholder?: string;
}

const TimeInput: React.FC<TimeInputProps> = ({
  value,
  onChange,
  disabled,
  className,
  title,
  placeholder = '--:--',
}) => (
  <input
    type="text"
    inputMode="numeric"
    placeholder={placeholder}
    maxLength={5}
    value={value}
    disabled={disabled}
    title={title}
    onChange={(e) => onChange(maskTime(e.target.value))}
    className={className}
  />
);

export default TimeInput;
