'use client';

import { KeyboardEvent, useState } from 'react';

export const ChipInput = ({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) => {
  const [value, setValue] = useState('');

  const add = () => {
    const next = value.trim();
    if (!next || values.includes(next)) return;
    onChange([...values, next]);
    setValue('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    }
  };

  return (
    <div>
      <label>{label}</label>
      <div className="chip-row">
        {values.map((tag) => (
          <button key={tag} type="button" className="chip" onClick={() => onChange(values.filter((v) => v !== tag))}>
            {tag}
          </button>
        ))}
      </div>
      <input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} />
      <button type="button" onClick={add}>
        add
      </button>
    </div>
  );
};
