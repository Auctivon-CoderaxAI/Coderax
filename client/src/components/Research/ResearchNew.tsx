import { useId, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@coderax/client';
import { Link, useNavigate } from 'react-router-dom';
import { MAX_RESEARCH_QUESTION_LENGTH, MAX_RESEARCH_TITLE_LENGTH } from 'coderax-data-provider';
import { useCreateResearchProjectMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function ResearchNew() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const titleId = useId();
  const questionId = useId();
  const createProject = useCreateResearchProjectMutation();
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError(localize('com_research_title_required'));
      return;
    }
    setError(null);
    createProject.mutate(
      { title: trimmed, question: question.trim() },
      {
        onSuccess: (project) => navigate(`/research/${project._id}`),
        onError: () => setError(localize('com_research_create_error')),
      },
    );
  };

  return (
    <main className="bg-surface-primary h-full min-h-0 w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <Link
          to="/research"
          className="text-text-secondary hover:text-text-primary focus-visible:ring-ring-primary inline-flex items-center gap-2 rounded-lg text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {localize('com_research_back')}
        </Link>
        <h1 className="text-text-primary mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
          {localize('com_research_new_title')}
        </h1>
        <p className="text-text-secondary mt-1 text-sm leading-6">
          {localize('com_research_new_subtitle')}
        </p>

        <form
          onSubmit={submit}
          className="border-border-light bg-surface-secondary mt-6 space-y-5 rounded-2xl border p-5"
        >
          <div>
            <label htmlFor={titleId} className="text-text-primary block text-sm font-medium">
              {localize('com_research_title_label')}
            </label>
            <input
              id={titleId}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (error != null) {
                  setError(null);
                }
              }}
              maxLength={MAX_RESEARCH_TITLE_LENGTH}
              placeholder={localize('com_research_title_placeholder')}
              className="border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary mt-1.5 h-10 w-full rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              aria-invalid={Boolean(error) || undefined}
            />
          </div>

          <div>
            <label htmlFor={questionId} className="text-text-primary block text-sm font-medium">
              {localize('com_research_question_label')}
            </label>
            <textarea
              id={questionId}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={MAX_RESEARCH_QUESTION_LENGTH}
              rows={4}
              placeholder={localize('com_research_question_placeholder')}
              className="border-border-light bg-surface-primary text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring-primary mt-1.5 w-full resize-y rounded-xl border px-3 py-2 text-sm leading-6 focus-visible:ring-2 focus-visible:outline-none"
            />
            <p className="text-text-tertiary mt-1 text-right text-xs">
              {question.length}/{MAX_RESEARCH_QUESTION_LENGTH}
            </p>
          </div>

          {error ? (
            <p className="text-text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="default" disabled={createProject.isLoading}>
              {createProject.isLoading
                ? localize('com_research_creating')
                : localize('com_research_create')}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/research')}>
              {localize('com_research_cancel')}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
