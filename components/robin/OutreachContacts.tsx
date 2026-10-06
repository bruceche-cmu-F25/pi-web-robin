import type { JarvisLead } from "@/extension/robin/jarvis-shape";
import { channelName, OUTREACH_CHANNELS } from "@/extension/robin/outreach-shape";
import styles from "./OutreachRoster.module.css";

export function OutreachContacts({ lead, zh }: { lead: JarvisLead; zh: boolean }) {
  const website = lead.websiteResearch;
  return <div className={styles.routes}>
    <span className={styles.mobileLabel}>{zh ? "全部联系方式" : "All contact routes"}</span>
    {lead.email ? <div className={styles.email}><span>{lead.email}</span><a href={lead.emailSource || lead.profileUrl} target="_blank" rel="noreferrer">{lead.emailCheck === "source_found" ? (zh ? "公开来源 ↗" : "Source ↗") : (zh ? "待验证 ↗" : "Unverified ↗")}</a></div> : <small>{zh ? "未找到公开邮箱" : "No public email found"}</small>}
    <div className={styles.socials}>{OUTREACH_CHANNELS.flatMap((p) => p !== "email" && lead.socials?.[p] ? [<a key={p} href={lead.socials[p]} target="_blank" rel="noreferrer" title={lead.socials[p]}>{channelName(p)} ↗</a>] : [])}<a href={lead.profileUrl} target="_blank" rel="noreferrer">{zh ? "个人资料 ↗" : "Profile ↗"}</a></div>
    {website ? <div className={styles.websiteRoutes}>
      <strong>{zh ? `官网发现结果 · ${website.contacts.length} 个入口` : `Website findings · ${website.contacts.length} routes`}</strong>
      <span>{website.status === "found" ? (zh ? "已找到公开入口，仍需人工确认收件人" : "Public routes found; verify the recipient") : website.status === "none" ? (zh ? "已检查，官网未公开联系方式" : "Checked; no public website contact") : website.status === "blocked" ? (zh ? "官网阻止自动读取，请人工打开" : "Website blocked automated reading; open manually") : (website.note || website.status)}</span>
      <div className={styles.websiteLinks}>{website.websiteUrl ? <a href={website.websiteUrl} target="_blank" rel="noreferrer">{zh ? "公司官网 ↗" : "Company website ↗"}</a> : null}{website.contacts.map((contact) => {
        const label = contact.kind === "personal_email" ? (zh ? "个人邮箱" : "Personal email") : contact.kind === "company_email" ? (zh ? "公司邮箱" : "Company email") : contact.kind === "contact_form" ? (zh ? "联系表单" : "Contact form") : (zh ? "电话" : "Phone");
        const href = contact.kind.endsWith("email") ? `mailto:${contact.value}` : contact.kind === "phone" ? `tel:${contact.value}` : contact.value;
        return <a key={`${contact.kind}:${contact.value}`} href={href} target={contact.kind === "phone" || contact.kind.endsWith("email") ? undefined : "_blank"} rel="noreferrer" title={contact.sourceUrl}>{label} · {contact.value} ↗</a>;
      })}</div>
      <small>{zh ? "公司邮箱与表单不会自动加入邮件发送箱。" : "Company inboxes and forms are never added to the email outbox automatically."}</small>
    </div> : null}
  </div>;
}
