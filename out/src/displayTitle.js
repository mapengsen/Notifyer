"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanSessionTitle = cleanSessionTitle;
/** Remove transport/attachment decorations from a display excerpt, never the source message. */
function cleanSessionTitle(value) {
    if (typeof value !== "string")
        return "";
    let text = value.replace(/&lt;(\/?(?:pasted_content|image|image_attachment|attachment|file|document)\b[\s\S]*?)&gt;/gi, "<$1>");
    const image = /\[(?:Image|图片)(?=\s*:|\s*#?\d*\s*\])|<image(?:_attachment)?\b|\bdata:image\/|^\s*Image attachment:\s*true\s*$/im.test(text);
    const attachment = /<\/?(?:pasted_content|attachment|file|document)\b|\[(?:File|Attachment|文件|附件)\s*:|^# Files mentioned by the user:/im.test(text);
    if (/^# Files mentioned by the user:/im.test(text)) {
        const request = /^## My request:\s*/im.exec(text);
        text = request ? text.slice(request.index + request[0].length) : "";
    }
    text = text
        .replace(/<image(?:_attachment)?\b[^>]*>[\s\S]*?<\/image(?:_attachment)?\s*>/gi, " ")
        .replace(/<\/?(?:pasted_content|image|image_attachment|attachment|file|document)\b[^>]*>/gi, " ")
        .replace(/\[(?:Image|图片|File|Attachment|文件|附件)\s*:[^\]]*\]/gi, " ")
        .replace(/\[(?:Image|图片)(?:\s*#?\d+)?\]/gi, " ")
        .replace(/Multiply coordinates by\s+\d+(?:\.\d+)?\s+to map to (?:the )?original image\.?/gi, " ")
        .replace(/\bdata:image\/[\w.+-]+;base64,[a-z\d+/=]+/gi, " ")
        .replace(/^\s*Image attachment:\s*(?:true|false)\s*$/gim, " ")
        // Old stored excerpts may end in the middle of an attachment marker.
        .replace(/\[(?:Image|图片|File|Attachment|文件|附件)\s*:[^\]]*$/gi, " ")
        .replace(/<\/?(?:pasted_content|image|image_attachment|attachment|file|document)\b[^>]*$/gi, " ")
        .replace(/\s+/g, " ").trim();
    return text ? Array.from(text).slice(0, 100).join("") : image ? "图片消息" : attachment ? "附件消息" : "";
}
