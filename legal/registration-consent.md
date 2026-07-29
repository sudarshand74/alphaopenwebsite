# Registration Consent Language and Acceptance Record

## Required on-screen disclosure

Place this immediately above the registration or season-participation submit button:

> **Participation agreement**
>
> Tennis involves risks of serious injury, illness, property damage, disability, and death. AlphaOpen is operated primarily by volunteers. Please read the Participant Agreement carefully; it includes an assumption of risk, a release and waiver of certain claims—including claims based on ordinary negligence to the fullest extent permitted by law—and an agreement not to sue on released claims.

## Required checkbox

The box must be unchecked by default:

> ☐ I have read and voluntarily agree to the [AlphaOpen Participant Agreement, Assumption of Risk, Release and Waiver] and acknowledge the [Privacy Policy]. I understand that I am electronically signing a legally binding agreement and releasing certain legal rights.

## Electronic-signature field

Label:

> Full legal name (electronic signature)

Supporting text:

> By entering my name and selecting “Agree and Register,” I intend to sign the Participant Agreement electronically.

Button:

> Agree and Register

## Optional publicity permission

Use a separate box, unchecked by default:

> ☐ I give AlphaOpen permission to use photographs or video in which I appear for league news, historical records, and noncommercial promotion. I may withdraw this permission for future uses by emailing AlphaOpenEC@gmail.com.

## Record to retain

For each acceptance, store:

- stable acceptance ID;
- player ID;
- participant's entered legal name;
- verified email address or other verified identity;
- exact agreement title and version/hash;
- Privacy Policy version acknowledged;
- UTC acceptance timestamp;
- season ID, if applicable;
- consent text displayed;
- checkbox state;
- electronic-signature intent;
- source workflow (self-registration, administrator-assisted registration, or imported-player follow-up);
- IP address and user agent only if counsel confirms they are appropriate and the Privacy Policy discloses them; and
- superseded/revoked status without overwriting the original record.

The agreement text accepted by the participant should be retained in immutable or versioned storage. Do not merely store `waiverAccepted: true`, because that does not establish which terms were presented.

## Imported or administrator-added players

An administrator must not accept the agreement on a player's behalf. Send the player a unique consent link and keep the player in an “agreement pending” status. Do not place the player in an active lineup until the player's own acceptance is recorded.

## Minor participants

Do not use this adult flow for a minor. Use a separately reviewed parent/guardian agreement that identifies both the minor and guardian and addresses state-specific rules on parental waivers and medical authorization.
