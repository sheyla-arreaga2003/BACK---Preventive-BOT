import { ReminderType } from '../enums/reminder.enum.js';
import type { ReminderTemplateParams, ReminderTemplateResult } from '../interfaces/reminder.interface.js';
import { getReminderContent } from '../services/reminder.service.js';


export function generateReminderTemplate(
    data: ReminderTemplateParams
): ReminderTemplateResult {

    const content = getReminderContent(data);

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width">
    <title>${content.subject}</title>
</head>

<body
    style="
        margin:0;
        padding:0;
        background:#f4f5f7;
        font-family:Arial,Helvetica,sans-serif;
        color:#172033;
    "
>

<table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
        width:100%;
        background:#f4f5f7;
        padding:35px 15px;
    "
>
    <tr>
        <td align="center">

            <table
                width="600"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="
                    width:100%;
                    max-width:600px;
                    background:#ffffff;
                    border-radius:20px;
                    overflow:hidden;
                    border:1px solid #e8eaee;
                "
            >

                <!-- LOGO -->

                <tr>
                    <td style="padding:28px 32px 20px 32px;">

                        <table width="100%">
                            <tr>

                                <td>
                                    <img
                                        src="https://res.cloudinary.com/bopiigg6/image/upload/f_auto,q_auto/c0e03142-2ab3-40cd-8b81-9de5bc92acaf"
                                        width="150"
                                        alt="Mototec"
                                        style="
                                            display:block;
                                            max-width:150px;
                                            border:0;
                                        "
                                    >
                                </td>

                                <td
                                    align="right"
                                    style="
                                        color:#8590a3;
                                        font-size:12px;
                                        line-height:18px;
                                    "
                                >
                                    Tu moto,<br>
                                    siempre en buenas manos.
                                </td>

                            </tr>
                        </table>

                    </td>
                </tr>


                <!-- HEADER -->

                <tr>
                    <td style="padding:15px 32px 25px 32px;">

                        <div
                            style="
                                display:inline-block;
                                padding:8px 14px;
                                background:${content.badgeBackground};
                                color:${content.badgeColor};
                                border-radius:20px;
                                font-size:12px;
                                font-weight:bold;
                            "
                        >
                            ${content.badge}
                        </div>

                        <h1
                            style="
                                margin:22px 0 15px 0;
                                font-size:30px;
                                line-height:35px;
                                color:#162036;
                            "
                        >
                            ${content.title}
                        </h1>

                        <p
                            style="
                                margin:0;
                                color:#57667d;
                                line-height:24px;
                                font-size:15px;
                            "
                        >
                            Hola <strong>${data.clientName}</strong>,
                            <br><br>

                            ${content.message}
                        </p>

                    </td>
                </tr>


                <!-- DETAILS -->

                <tr>
                    <td style="padding:0 32px;">

                        <table
                            width="100%"
                            cellpadding="0"
                            cellspacing="0"
                            style="
                                border:1px solid #e5e7eb;
                                border-radius:14px;
                                background:#ffffff;
                            "
                        >

                            ${detailRow('📅', 'Fecha', data.date)}

                            ${detailRow('🕐', 'Hora', data.time)}

                            ${detailRow(
                                '🏍️',
                                'Motocicleta',
                                data.motorcycle
                            )}

                            ${detailRow('▣', 'Placa', data.plate)}

                            ${detailRow(
                                '📍',
                                'Agencia',
                                data.agency,
                                false
                            )}

                        </table>

                    </td>
                </tr>

                <!-- NOTICE -->

                <tr>
                    <td style="padding:0 32px 30px;">

                        <div
                            style="
                                padding:15px;
                                border-radius:12px;
                                background:${content.noticeBackground};
                                color:#65728a;
                                font-size:12px;
                                line-height:18px;
                            "
                        >
                            ${content.notice}
                        </div>

                    </td>
                </tr>


                <!-- FOOTER -->

                <tr>
                    <td
                        align="center"
                        style="
                            padding:25px 30px;
                            border-top:1px solid #eeeeee;
                            color:#8993a5;
                            font-size:11px;
                            line-height:18px;
                        "
                    >

                        Mototec · Agencia de motocicletas

                        <br>

                        Este correo fue generado automáticamente.

                    </td>
                </tr>

            </table>

        </td>
    </tr>
</table>

</body>
</html>
`;

    return {
        subject: content.subject,
        html
    };
}

function detailRow(
    icon: string,
    label: string,
    value: string,
    border: boolean = true
): string {

    return `
<tr>

    <td
        width="40"
        style="
            padding:14px 5px 14px 18px;
            ${border ? 'border-bottom:1px solid #eeeeee;' : ''}
        "
    >
        ${icon}
    </td>

    <td
        style="
            padding:14px 10px;
            color:#778197;
            font-size:13px;
            ${border ? 'border-bottom:1px solid #eeeeee;' : ''}
        "
    >
        ${label}
    </td>

    <td
        align="right"
        style="
            padding:14px 18px 14px 10px;
            color:#172033;
            font-size:13px;
            font-weight:bold;
            ${border ? 'border-bottom:1px solid #eeeeee;' : ''}
        "
    >
        ${value}
    </td>

</tr>
`;
}