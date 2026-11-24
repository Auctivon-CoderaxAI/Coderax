import React from 'react';

type SocialButtonProps = {
  id: string;
  enabled: boolean;
  serverDomain?: string | null;
  oauthPath: string;
  Icon: React.ComponentType;
  label?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
};

const SocialButton = ({
  id,
  enabled,
  serverDomain,
  oauthPath,
  Icon,
  label,
  onClick,
}: SocialButtonProps) => {
  if (!enabled) {
    return null;
  }

  return (
    <div className="mt-2 flex gap-x-2">
      <a
        aria-label={`${label}`}
        className="border-border-light bg-surface-primary text-text-primary hover:bg-surface-tertiary flex w-full items-center space-x-3 rounded-2xl border px-5 py-3 transition-colors duration-200"
        href={`${serverDomain}/oauth/${oauthPath}`}
        data-testid={id}
        onClick={onClick}
      >
        <Icon />
        <p>{label}</p>
      </a>
    </div>
  );
};

export default SocialButton;
