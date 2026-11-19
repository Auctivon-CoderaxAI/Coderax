import { useForm } from 'react-hook-form';
import { Button, SecretInput, Spinner } from '@coderax/client';
import type { TPasswordLogin } from '~/common';
import { useLocalize } from '~/hooks';
import { useAuthContext } from '~/hooks/AuthContext';
import { ErrorMessage } from './ErrorMessage';

export default function PasswordLoginForm() {
  const localize = useLocalize();
  const { passwordLogin, passwordLoginError } = useAuthContext();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TPasswordLogin>();

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-text-primary text-2xl font-semibold">
        {localize('com_auth_password_only_title')}
      </h1>
      <p className="text-text-secondary mt-2 text-sm">
        {localize('com_auth_password_only_description')}
      </p>

      {passwordLoginError ? <ErrorMessage>{localize('com_auth_error_login')}</ErrorMessage> : null}

      <form
        className="mt-6"
        aria-label={localize('com_auth_password_only_title')}
        method="POST"
        onSubmit={handleSubmit((data) => passwordLogin(data))}
      >
        <div className="mb-2">
          <SecretInput
            colorTransition
            id="password"
            autoComplete="current-password"
            aria-label={localize('com_auth_password')}
            {...register('password', {
              required: localize('com_auth_password_required'),
            })}
            aria-invalid={!!errors.password}
            placeholder=" "
            label={localize('com_auth_password')}
          />
          {errors.password?.message ? (
            <span role="alert" className="text-text-destructive mt-1 block text-sm">
              {String(errors.password.message)}
            </span>
          ) : null}
        </div>

        <div className="mt-6">
          <Button
            aria-label={localize('com_auth_continue')}
            data-testid="password-login-button"
            type="submit"
            disabled={isSubmitting}
            variant="submit"
            className="w-full"
          >
            {isSubmitting ? <Spinner /> : localize('com_auth_continue')}
          </Button>
        </div>
      </form>
    </div>
  );
}
