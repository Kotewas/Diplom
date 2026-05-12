package com.diplom.dispatcher.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;
import java.util.stream.Stream;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final List<String> allowedOriginPatterns;

    public CorsConfig(@Value("${app.cors.allowed-origins:*}") String allowedOriginsRaw) {
        this.allowedOriginPatterns = Stream.of(allowedOriginsRaw.split(","))
                .map(String::trim)
                .filter(value -> !value.isBlank())
                .toList();
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(allowedOriginPatterns.toArray(new String[0]))
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(false);
    }
}
