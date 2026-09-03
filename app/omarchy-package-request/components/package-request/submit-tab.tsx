"use client"

import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

const EMPTY_FORM = {
  pkgname: "",
  url: "",
  description: "",
  license: "",
  submitter: "",
}

export function SubmitTab({ onSubmitted }: { onSubmitted: () => void }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function updateField(field: keyof typeof EMPTY_FORM) {
    return (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const message = body?.error ?? `Request failed (${res.status})`
        setError(message)
        toast.add({
          title: "Submission failed",
          description: message,
          type: "error",
        })
        return
      }
      setSuccess(`Request for '${form.pkgname}' submitted.`)
      toast.add({
        title: "Request submitted",
        description: `'${form.pkgname}' was filed as a package request.`,
        type: "success",
      })
      setForm(EMPTY_FORM)
      onSubmitted()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed"
      setError(message)
      toast.add({
        title: "Submission failed",
        description: message,
        type: "error",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Submit a package request</CardTitle>
        <CardDescription>
          File a new request for an Omarchy AUR package. A maintainer will
          review it in the approval queue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="pkgname">Package name</FieldLabel>
              <Input
                id="pkgname"
                value={form.pkgname}
                onChange={updateField("pkgname")}
                placeholder="my-cool-package"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="url">Source URL</FieldLabel>
              <Input
                id="url"
                type="url"
                value={form.url}
                onChange={updateField("url")}
                placeholder="https://github.com/owner/repo"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea
                id="description"
                value={form.description}
                onChange={updateField("description")}
                placeholder="What does this package do?"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="license">License</FieldLabel>
              <Input
                id="license"
                value={form.license}
                onChange={updateField("license")}
                placeholder="MIT"
                required
              />
              <FieldDescription>
                SPDX identifier, e.g. MIT, GPL-3.0.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="submitter">Your name</FieldLabel>
              <Input
                id="submitter"
                value={form.submitter}
                onChange={updateField("submitter")}
                placeholder="jdoe"
                required
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
            {success && (
              <FieldDescription className="text-sm text-foreground">
                {success}
              </FieldDescription>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit request"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
