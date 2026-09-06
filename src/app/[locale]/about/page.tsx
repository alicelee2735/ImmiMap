import { ExternalLink } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageContainer } from "@/components/layout/page-container";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ locale: string }>;
};

const DATA_CORRECTION_FORM_URL = "https://forms.gle/SZryGqpSC6N3RV6F6";
const VOLUNTEER_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfjcBmS-KB04fDN_W9rjSykCMeIvjeydV6X5ybj9pbX92RQ7Q/viewform?usp=sharing&ouid=101924067461914459610";

const FLAG_ACCENTS = ["border-l-route-blue", "border-l-signal-amber"] as const;

export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("About");
  const sections = [
    {
      number: "01",
      title: t("mission.title"),
      description: t("mission.description"),
    },
    {
      number: "02",
      title: t("story.title"),
      description: t("story.description"),
    },
    {
      number: "03",
      title: t("transparency.title"),
      description: t("transparency.description"),
      href: "/how-we-verify" as const,
      linkPrompt: t("transparency.verifyPrompt"),
      linkLabel: t("transparency.verifyLink"),
    },
  ];

  return (
    <main className="flex-1 bg-paper pb-16 pt-12 sm:pt-16">
      <PageContainer>
        <p className="text-sm font-medium uppercase tracking-widest text-route-blue">
          {t("eyebrow")}
        </p>
        <h1 className="mt-5 max-w-3xl font-serif text-4xl font-semibold tracking-[-0.01em] text-ink-navy sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
          {t("title")}
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-8 text-charcoal sm:text-lg">
          {t("lead")}
        </p>

        {/*
          Route-line numbering — same hollow amber marker + connector as
          the homepage how-it-works sequence. Cards keep their title/body.
        */}
        <ol className="mt-10 hidden md:grid md:grid-cols-3 md:gap-5">
          {sections.map((section, index) => {
            const isLast = index === sections.length - 1;
            return (
              <li key={section.number} className="flex items-center gap-3">
                <span
                  className="h-3 w-3 shrink-0 rounded-full border-2 border-signal-amber bg-paper"
                  aria-hidden="true"
                />
                <span className="font-serif text-2xl font-semibold tabular-nums tracking-wide text-ink-navy">
                  {section.number}
                </span>
                {!isLast ? (
                  <span
                    className="-mr-5 h-px min-w-4 flex-1 bg-signal-amber/60"
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="mt-8 grid gap-5 md:mt-5 md:grid-cols-3">
          {sections.map((section, index) => {
            const isLast = index === sections.length - 1;
            return (
              <article
                key={section.title}
                className={cn(
                  "border-l-4 bg-paper p-6 shadow-[0_8px_30px_-12px_rgba(27,42,74,0.12)] sm:p-8",
                  FLAG_ACCENTS[index % FLAG_ACCENTS.length],
                )}
              >
                <div className="mb-4 flex items-center gap-3 md:hidden">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border-2 border-signal-amber bg-paper"
                    aria-hidden="true"
                  />
                  <span className="font-serif text-2xl font-semibold tabular-nums tracking-wide text-ink-navy">
                    {section.number}
                  </span>
                  {!isLast ? (
                    <span
                      className="h-px min-w-4 flex-1 bg-signal-amber/60"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <h2 className="text-lg font-semibold tracking-tight text-ink-navy sm:text-xl">
                  {section.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-charcoal">
                  {section.description}
                </p>
                {"href" in section && section.href ? (
                  <p className="mt-4 text-sm leading-6 text-charcoal">
                    {section.linkPrompt}{" "}
                    <Link
                      href={section.href}
                      className="font-medium text-ink-navy underline-offset-4 transition-colors hover:text-route-blue hover:underline"
                    >
                      {section.linkLabel}
                    </Link>
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <section className="border-l-4 border-l-signal-amber bg-paper p-6 shadow-[0_8px_30px_-12px_rgba(27,42,74,0.12)] sm:p-8">
            <h2 className="font-serif text-xl font-semibold tracking-tight text-ink-navy sm:text-2xl">
              {t("dataCorrection.title")}
            </h2>
            <p className="mt-3 text-sm leading-7 text-charcoal sm:text-base sm:leading-8">
              {t("dataCorrection.description")}
            </p>
            <a
              href={DATA_CORRECTION_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-ink-navy bg-signal-amber px-7 text-base font-semibold text-ink-navy hover:bg-signal-amber/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-amber focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              {t("dataCorrection.openForm")}
            </a>
            <p className="mt-5 text-sm leading-7 text-charcoal/75">
              {t("dataCorrection.generalQuestions.prompt")}{" "}
              <Link
                href="/contact"
                className="font-medium text-ink-navy underline-offset-4 transition-colors hover:text-route-blue hover:underline"
              >
                {t("dataCorrection.generalQuestions.link")}
              </Link>
            </p>
          </section>

          <section className="border-l-4 border-l-signal-amber bg-paper p-6 shadow-[0_8px_30px_-12px_rgba(27,42,74,0.12)] sm:p-8">
            <h2 className="font-serif text-xl font-semibold tracking-tight text-ink-navy sm:text-2xl">
              {t("volunteer.title")}
            </h2>
            <p className="mt-3 text-sm leading-7 text-charcoal sm:text-base sm:leading-8">
              {t("volunteer.description")}
            </p>
            <a
              href={VOLUNTEER_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-ink-navy bg-signal-amber px-7 text-base font-semibold text-ink-navy hover:bg-signal-amber/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-amber focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              {t("volunteer.openForm")}
            </a>
          </section>
        </div>
      </PageContainer>
    </main>
  );
}
