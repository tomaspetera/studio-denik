/**
 * Značka pro chybu uvnitř už rozběhnutého streamu.
 *
 * Jakmile odejde hlavička odpovědi, stavový kód se změnit nedá — chybu je
 * proto potřeba propašovat samotným tělem. Nulový znak se v generovaném
 * textu vyskytnout nemůže, takže nehrozí, že by ho klient spletl s obsahem.
 *
 * Sdílené mezi serverovou trasou a prohlížečem, proto vlastní soubor
 * bez `server-only`.
 */
export const ERROR_MARK = "\u0000";