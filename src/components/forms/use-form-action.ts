'use client';

import { startTransition, useActionState, type FormEvent } from 'react';

/**
 * useActionState for forms that must keep what the user typed when the
 * server rejects it. Passing an action straight to <form action> makes React
 * reset every uncontrolled field after submission — including on validation
 * errors — so this submits via onSubmit instead.
 */
export function useFormAction<State>(
  action: (state: Awaited<State>, formData: FormData) => State | Promise<State>,
  initialState: Awaited<State>,
) {
  const [state, dispatch, isPending] = useActionState(action, initialState);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }
  return [state, onSubmit, isPending] as const;
}
