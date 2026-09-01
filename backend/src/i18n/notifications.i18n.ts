export type Locale = 'fr'|'en'|'es'|'de'|'zh';
const D: Record<Locale, any> = {
  fr: {
    emailImmediateSubject: (c:string,v:string)=>`Nouvelle version : ${c}@${v}`,
    emailDigestSubject: (n:number)=>`Récapitulatif : ${n} nouvelle(s) version(s)`,
    emailImmediateTitle: 'Nouvelle version disponible 🎉',
    emailImmediateIntro: 'Un artifact que vous suivez vient de publier une nouvelle version :',
    emailEcosystem: 'Écosystème', emailArtifact: 'Artifact', emailVersion: 'Version',
    emailDashboard: 'Connectez-vous à votre dashboard pour gérer vos abonnements.',
    emailDigestTitle: 'Votre récapitulatif de versions 📦',
    emailDigestIntro: 'Voici les nouvelles versions publiées depuis votre dernier récapitulatif :',
    telegramImmediate: (eco:string, coord:string, ver:string)=>`📦 <b>Nouvelle version</b>\n${eco} <code>${coord}</code>\nVersion: <b>${ver}</b>`,
    telegramDigestHeader: (n:number)=>`📦 <b>Récapitulatif — ${n} nouvelle(s) version(s)</b>`,
  },
  en: {
    emailImmediateSubject: (c:string,v:string)=>`New version: ${c}@${v}`,
    emailDigestSubject: (n:number)=>`Digest: ${n} new version(s)`,
    emailImmediateTitle: 'New version available 🎉',
    emailImmediateIntro: 'An artifact you follow has published a new version:',
    emailEcosystem: 'Ecosystem', emailArtifact: 'Artifact', emailVersion: 'Version',
    emailDashboard: 'Log in to your dashboard to manage your subscriptions.',
    emailDigestTitle: 'Your version digest 📦',
    emailDigestIntro: 'Here are the new versions since your last digest:',
    telegramImmediate: (eco:string, coord:string, ver:string)=>`📦 <b>New version</b>\n${eco} <code>${coord}</code>\nVersion: <b>${ver}</b>`,
    telegramDigestHeader: (n:number)=>`📦 <b>Digest — ${n} new version(s)</b>`,
  },
  es: {
    emailImmediateSubject: (c:string,v:string)=>`Nueva versión: ${c}@${v}`,
    emailDigestSubject: (n:number)=>`Resumen: ${n} nueva(s) versión(es)`,
    emailImmediateTitle: 'Nueva versión disponible 🎉',
    emailImmediateIntro: 'Un artefacto que sigues ha publicado una nueva versión:',
    emailEcosystem: 'Ecosistema', emailArtifact: 'Artefacto', emailVersion: 'Versión',
    emailDashboard: 'Inicia sesión en tu dashboard para gestionar tus suscripciones.',
    emailDigestTitle: 'Tu resumen de versiones 📦',
    emailDigestIntro: 'Estas son las nuevas versiones desde tu último resumen:',
    telegramImmediate: (eco:string, coord:string, ver:string)=>`📦 <b>Nueva versión</b>\n${eco} <code>${coord}</code>\nVersión: <b>${ver}</b>`,
    telegramDigestHeader: (n:number)=>`📦 <b>Resumen — ${n} nueva(s) versión(es)</b>`,
  },
  de: {
    emailImmediateSubject: (c:string,v:string)=>`Neue Version: ${c}@${v}`,
    emailDigestSubject: (n:number)=>`Zusammenfassung: ${n} neue Version(en)`,
    emailImmediateTitle: 'Neue Version verfügbar 🎉',
    emailImmediateIntro: 'Ein von dir verfolgtes Artefakt hat eine neue Version veröffentlicht:',
    emailEcosystem: 'Ökosystem', emailArtifact: 'Artefakt', emailVersion: 'Version',
    emailDashboard: 'Melde dich im Dashboard an, um deine Abonnements zu verwalten.',
    emailDigestTitle: 'Deine Versionszusammenfassung 📦',
    emailDigestIntro: 'Hier sind die neuen Versionen seit deiner letzten Zusammenfassung:',
    telegramImmediate: (eco:string, coord:string, ver:string)=>`📦 <b>Neue Version</b>\n${eco} <code>${coord}</code>\nVersion: <b>${ver}</b>`,
    telegramDigestHeader: (n:number)=>`📦 <b>Zusammenfassung — ${n} neue Version(en)</b>`,
  },
  zh: {
    emailImmediateSubject: (c:string,v:string)=>`新版本：${c}@${v}`,
    emailDigestSubject: (n:number)=>`汇总：${n} 个新版本`,
    emailImmediateTitle: '有新版本可用 🎉',
    emailImmediateIntro: '你关注的制品发布了新版本：',
    emailEcosystem: '生态', emailArtifact: '制品', emailVersion: '版本',
    emailDashboard: '登录到你的面板以管理订阅。',
    emailDigestTitle: '你的版本汇总 📦',
    emailDigestIntro: '自上次汇总以来发布的新版本如下：',
    telegramImmediate: (eco:string, coord:string, ver:string)=>`📦 <b>新版本</b>\n${eco} <code>${coord}</code>\n版本：<b>${ver}</b>`,
    telegramDigestHeader: (n:number)=>`📦 <b>汇总 — ${n} 个新版本</b>`,
  },
};
export function getLocale(l?: string): Locale { return (['fr','en','es','de','zh'].includes(l as any) ? l : 'fr') as Locale; }
export function t(locale: string | undefined, key: string, ...args: any[]): string {
  const loc = getLocale(locale as any);
  const entry = (D[loc] as any)[key] ?? (D.fr as any)[key];
  return typeof entry === 'function' ? entry(...args) : entry;
}
