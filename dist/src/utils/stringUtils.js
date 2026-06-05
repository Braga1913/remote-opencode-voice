export function sanitizeModel(model) {
    return model.trim().replace(/\r/g, '');
}
