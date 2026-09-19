/** Digits of an Indian mobile number, without any +91 / 91 country prefix. */
function localDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

/** `tel:` link for the number as typed, or undefined when it's blank. */
export function telHref(phone: string): string | undefined {
  const local = localDigits(phone);
  return local ? `tel:${local}` : undefined;
}

/** WhatsApp chat link for the number as typed, or undefined when it's blank.
 *  A number already carrying +91 / 91 isn't double-prefixed. */
export function whatsappHref(phone: string): string | undefined {
  const local = localDigits(phone);
  return local ? `https://wa.me/91${local}` : undefined;
}
