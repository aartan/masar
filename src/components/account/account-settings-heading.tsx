interface AccountSettingsHeadingProps {
  title: string;
  description: string;
}

export function AccountSettingsHeading({
  title,
  description,
}: AccountSettingsHeadingProps) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground/60 uppercase">
        ACCOUNT SETTINGS
      </p>
      <h1 className="font-display mt-2 text-[28px] leading-tight font-semibold text-foreground sm:text-[32px]">
        {title}
      </h1>
      <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
