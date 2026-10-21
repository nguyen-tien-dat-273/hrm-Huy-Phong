/**
 * Chạy trong Google Apps Script để tạo Google Form tuyển dụng và webhook.
 * Điền API_URL, API_TOKEN và REQUISITION_CODE trong Project Settings > Script Properties.
 */
const RECRUITMENT_FORM_FIELDS = {
  fullName: 'Họ và tên',
  email: 'Email',
  phone: 'Số điện thoại',
  cv: 'Tải CV',
  note: 'Giới thiệu thêm',
  consent: 'Đồng ý lưu thông tin',
};

function createRecruitmentForm() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = requiredProperty_(props, 'API_URL');
  requiredProperty_(props, 'API_TOKEN');
  const requisitionCode = requiredProperty_(props, 'REQUISITION_CODE');
  if (!/^https:\/\//i.test(apiUrl)) throw new Error('API_URL phải bắt đầu bằng https://');

  const form = FormApp.create(`Ứng tuyển · ${requisitionCode}`);
  form.setPublished(true);
  form.setDescription('Vui lòng điền thông tin và tải CV để bộ phận tuyển dụng xem xét hồ sơ của bạn.');
  form.setConfirmationMessage('Cảm ơn bạn đã gửi hồ sơ. Bộ phận tuyển dụng sẽ liên hệ nếu hồ sơ phù hợp.');
  form.setProgressBar(true);

  form.addTextItem()
    .setTitle(RECRUITMENT_FORM_FIELDS.fullName)
    .setRequired(true);
  form.addTextItem()
    .setTitle(RECRUITMENT_FORM_FIELDS.email)
    .setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  form.addTextItem()
    .setTitle(RECRUITMENT_FORM_FIELDS.phone)
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle(RECRUITMENT_FORM_FIELDS.note)
    .setRequired(false);
  form.addCheckboxItem()
    .setTitle(RECRUITMENT_FORM_FIELDS.consent)
    .setChoiceValues(['Tôi đồng ý để công ty lưu và sử dụng thông tin, CV cho mục đích tuyển dụng.'])
    .setRequired(true);

  const responseSheet = SpreadsheetApp.create(`Câu trả lời tuyển dụng · ${requisitionCode}`);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, responseSheet.getId());

  // Forms Service chưa hỗ trợ tạo câu hỏi tải tệp bằng mã. Thêm câu hỏi này
  // thủ công trong form editor với đúng tiêu đề RECRUITMENT_FORM_FIELDS.cv.
  ScriptApp.newTrigger('onRecruitmentFormSubmit').forForm(form).onFormSubmit().create();

  props.setProperty('RECRUITMENT_FORM_ID', form.getId());
  console.log(`Link gửi ứng viên: ${form.getPublishedUrl()}`);
  console.log(`Link chỉnh sửa form: ${form.getEditUrl()}`);
  console.log(`Bảng câu trả lời: ${responseSheet.getUrl()}`);
  console.log(`Thêm câu hỏi File upload có tiêu đề: ${RECRUITMENT_FORM_FIELDS.cv}`);
}

function onRecruitmentFormSubmit(event) {
  if (!event || !event.response) throw new Error('Hàm này chỉ chạy từ trigger On form submit.');

  const props = PropertiesService.getScriptProperties();
  const answers = {};
  event.response.getItemResponses().forEach((itemResponse) => {
    answers[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });

  const fields = RECRUITMENT_FORM_FIELDS;
  const fullName = String(answers[fields.fullName] || '').trim();
  const email = String(answers[fields.email] || '').trim();
  const phone = String(answers[fields.phone] || '').trim();
  const note = String(answers[fields.note] || '').trim();
  const consentAnswer = answers[fields.consent];
  const fileAnswer = answers[fields.cv];
  const fileIds = Array.isArray(fileAnswer) ? fileAnswer : fileAnswer ? [fileAnswer] : [];

  if (!fullName || !email || !fileIds.length || !consentAnswer) {
    throw new Error('Thiếu họ tên, email, CV hoặc xác nhận đồng ý.');
  }

  // Một Form hỗ trợ nhiều tệp: gửi từng tệp thành một hồ sơ tài liệu riêng
  // bằng cách gửi từng submission id khác nhau không phù hợp. API hiện nhận một
  // CV URL, do đó mẫu này chọn tệp đầu tiên; đặt câu hỏi chỉ nhận một tệp.
  const cvUrl = DriveApp.getFileById(String(fileIds[0])).getUrl();
  const payload = {
    requisition_code: requiredProperty_(props, 'REQUISITION_CODE'),
    submission_id: event.response.getId(),
    full_name: fullName,
    email,
    phone,
    cv_url: cvUrl,
    note,
    consent: true,
  };

  const response = UrlFetchApp.fetch(requiredProperty_(props, 'API_URL'), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${requiredProperty_(props, 'API_TOKEN')}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`API tuyển dụng trả về ${status}: ${response.getContentText()}`);
  }
  console.log(`Đã đồng bộ ứng viên ${email}: ${response.getContentText()}`);
}

function requiredProperty_(properties, key) {
  const value = properties.getProperty(key);
  if (!value) throw new Error(`Thiếu Script Property: ${key}`);
  return value.trim();
}
