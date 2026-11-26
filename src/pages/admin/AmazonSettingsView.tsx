import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Copy, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react'
import { S } from './adminShared'
import {
  AMAZON_APP_REDIRECT_URI,
  AmazonAppSettingsError,
  loadAmazonAppSettings,
  saveAmazonAppSettings,
  type AmazonAppCredentials,
  type AmazonAppSettingsStatus,
} from '../../lib/amazonAppSettings'
import './AmazonSettingsView.css'

const EMPTY_VALUES: AmazonAppCredentials = { appId: '', clientId: '', clientSecret: '' }
const FIELDS = [
  { key: 'appId', label: 'معرّف التطبيق', name: 'Application ID' },
  { key: 'clientId', label: 'معرّف عميل تسجيل الدخول', name: 'LWA Client ID' },
  { key: 'clientSecret', label: 'المفتاح السري للعميل', name: 'LWA Client Secret' },
] as const

export default function AmazonSettingsView() {
  const [status, setStatus] = useState<AmazonAppSettingsStatus | null>(null)
  const [values, setValues] = useState<AmazonAppCredentials>(EMPTY_VALUES)
  const [errors, setErrors] = useState<Partial<Record<keyof AmazonAppCredentials, string>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setNotice(null)
    try {
      const next = await loadAmazonAppSettings()
      if (version !== requestVersion.current) return
      setStatus(next)
      setForbidden(false)
    } catch (error) {
      if (version !== requestVersion.current) return
      setStatus(null)
      setForbidden(error instanceof AmazonAppSettingsError && error.status === 403)
      setNotice({ type: 'err', text: error instanceof Error ? error.message : 'تعذر تحميل إعدادات أمازون.' })
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => { requestVersion.current += 1 }
  }, [load])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || saving || !status) return
    const nextErrors: Partial<Record<keyof AmazonAppCredentials, string>> = {}
    for (const field of FIELDS) if (!values[field.key].trim()) nextErrors[field.key] = `أدخل ${field.label}.`
    setErrors(nextErrors)
    const firstInvalid = FIELDS.find(field => nextErrors[field.key])
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid.key}"]`)?.focus()
      return
    }
    if ((status.configured || status.needsReplacement) && !window.confirm('سيتم استبدال إعدادات تطبيق أمازون لجميع التجار. تغيير هوية التطبيق قد يتطلب إعادة ربط الحسابات الحالية. هل تريد المتابعة؟')) return
    setSaving(true)
    setNotice(null)
    try {
      const next = await saveAmazonAppSettings(values)
      setStatus(next)
      setValues(EMPTY_VALUES)
      setNotice({ type: 'ok', text: 'تم حفظ إعدادات أمازون. يمكنك الآن بدء ربط حساب البائع من صفحة الربط والتكاملات.' })
    } catch (error) {
      if (error instanceof AmazonAppSettingsError && error.status === 403) {
        setForbidden(true)
        setValues(EMPTY_VALUES)
      }
      setNotice({ type: 'err', text: error instanceof Error ? error.message : 'تعذر حفظ إعدادات أمازون.' })
    } finally {
      setSaving(false)
    }
  }

  async function copyCallback() {
    try {
      await navigator.clipboard.writeText(AMAZON_APP_REDIRECT_URI)
      setCopied(true)
    } catch {
      setNotice({ type: 'err', text: 'تعذر نسخ الرابط. يمكنك تحديده ونسخه يدويًا.' })
    }
  }

  if (forbidden) return <section className="amazon-settings" style={S.formCard} role="alert">
    <ShieldCheck size={22} aria-hidden="true" />
    <h3>هذه الصفحة متاحة لمديري المنصة فقط.</h3>
    <p>استخدم حساب مدير منصة لديه الصلاحية لتعديل إعدادات التطبيق.</p>
  </section>

  return <section className="amazon-settings" aria-label="إعدادات تطبيق أمازون" aria-busy={loading || saving}>
    <p className="amazon-settings__intro">أضف بيانات تطبيق <bdi>Sellpert Dashboard</bdi> لتفعيل ربط حسابات البائعين. مزامنة الطلبات والتسويات ستتاح في تحديث لاحق.</p>
    <div className="amazon-settings__summary">
      <span role="status">{loading ? 'جارٍ التحقق من الإعدادات…' : status ? status.configured ? 'إعدادات التطبيق مكتملة' : 'إعدادات التطبيق تحتاج استكمالًا' : 'حالة الإعدادات غير متاحة'}</span>
      <button type="button" style={S.refreshBtn} onClick={() => void load()} disabled={loading || saving}><RefreshCw size={15} aria-hidden="true" /> تحديث الحالة</button>
    </div>

    {notice ? <div role={notice.type === 'err' ? 'alert' : 'status'} style={{ ...S.msgBox, ...(notice.type === 'ok' ? S.msgOk : S.msgErr), marginBottom: 16 }}>{notice.text}</div> : null}
    {status?.needsReplacement ? <p role="alert" style={{ ...S.msgBox, ...S.msgErr, marginBottom: 16 }}>تعذرت قراءة إعدادات أمازون المحفوظة. أعد إدخال القيم الثلاث لاستبدالها وإتاحة الربط مجددًا.</p> : null}

    <form ref={formRef} onSubmit={submit} noValidate style={S.formCard}>
      <h3 className="amazon-settings__title"><KeyRound size={18} aria-hidden="true" /> بيانات التطبيق</h3>
      <p id="amazon-settings-help" className="amazon-settings__help">لإضافة الإعدادات أو استبدالها، أدخل القيم الثلاث معًا. تُحفظ مشفّرة على الخادم ولا يمكن عرضها بعد الحفظ.</p>
      <p className="amazon-settings__help">هذه الإعدادات مشتركة لجميع التجار. تغيير معرّف التطبيق أو عميل تسجيل الدخول قد يتطلب إعادة ربط حسابات أمازون الحالية.</p>
      <fieldset disabled={loading || saving || !status} aria-describedby="amazon-settings-help">
        {FIELDS.map(field => <div className="amazon-settings__field" key={field.key}>
          <div className="amazon-settings__label-row">
            <label htmlFor={`amazon-${field.key}`} style={S.label}>{field.label} <span dir="ltr">({field.name})</span></label>
            <span className="amazon-settings__presence">{loading || !status ? 'لم يُتحقق' : status.needsReplacement ? 'تحتاج إعادة إدخال' : status.fields[field.key] ? 'محفوظ' : 'غير مهيأ'}</span>
          </div>
          <input id={`amazon-${field.key}`} name={field.key} type="password" dir="ltr"
            autoComplete="new-password" spellCheck={false} autoCapitalize="none" required maxLength={4096}
            value={values[field.key]} placeholder="أدخل القيمة الجديدة" style={S.input}
            aria-invalid={Boolean(errors[field.key])} aria-describedby={errors[field.key] ? `amazon-${field.key}-error` : 'amazon-settings-help'}
            onChange={event => {
              setValues(previous => ({ ...previous, [field.key]: event.target.value }))
              setErrors(previous => ({ ...previous, [field.key]: undefined }))
              setNotice(null)
            }} />
          {errors[field.key] ? <p id={`amazon-${field.key}-error`} className="amazon-settings__error">{errors[field.key]}</p> : null}
        </div>)}
        <div className="amazon-settings__actions">
          <button type="submit" style={S.saveBtn} disabled={saving || loading || !status}>{saving ? 'جارٍ الحفظ…' : status?.configured || status?.needsReplacement ? 'استبدال إعدادات أمازون' : 'حفظ إعدادات أمازون'}</button>
          <span>يتم حفظ القيم الثلاث معًا.</span>
        </div>
      </fieldset>
    </form>

    <section className="amazon-settings__connection" aria-labelledby="amazon-settings-connection-title">
      <h3 id="amazon-settings-connection-title">إعدادات الرجوع من أمازون</h3>
      <p className="amazon-settings__help">أضف هذا الرابط في إعدادات التطبيق لدى أمازون. يجب أن يسجّل التاجر دخوله إلى سيلبرت على النطاق نفسه.</p>
      <div className="amazon-settings__callback">
        <code dir="ltr">{AMAZON_APP_REDIRECT_URI}</code>
        <button type="button" style={S.refreshBtn} onClick={() => void copyCallback()}><Copy size={15} aria-hidden="true" /> {copied ? 'تم النسخ' : 'نسخ الرابط'}</button>
      </div>
      <p className="amazon-settings__draft"><span>وضع المسودة</span> التطبيق قيد التجربة في أمازون.</p>
    </section>
  </section>
}
