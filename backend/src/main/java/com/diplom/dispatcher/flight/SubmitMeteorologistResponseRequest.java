package com.diplom.dispatcher.flight;

import java.util.Map;

public record SubmitMeteorologistResponseRequest(
        Map<String, String> responseByNeed,
        String meteorologistMessage
) {
}
