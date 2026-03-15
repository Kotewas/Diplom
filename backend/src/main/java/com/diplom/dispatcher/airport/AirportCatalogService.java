package com.diplom.dispatcher.airport;

import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class AirportCatalogService {

    private static final List<AirportDto> AIRPORTS = List.of(
            new AirportDto("SVO", "Шереметьево", "Москва", 55.9726, 37.4146, "central"),
            new AirportDto("DME", "Домодедово", "Москва", 55.4088, 37.9063, "central"),
            new AirportDto("VKO", "Внуково", "Москва", 55.5915, 37.2615, "central"),
            new AirportDto("LED", "Пулково", "Санкт-Петербург", 59.8003, 30.2625, "northwest"),
            new AirportDto("MMK", "Мурманск", "Мурманск", 68.7817, 32.7508, "northwest"),
            new AirportDto("KGD", "Храброво", "Калининград", 54.89, 20.5926, "northwest"),
            new AirportDto("AER", "Сочи", "Сочи", 43.4499, 39.9566, "south"),
            new AirportDto("KRR", "Пашковский", "Краснодар", 45.0347, 39.1705, "south"),
            new AirportDto("ROV", "Платов", "Ростов-на-Дону", 47.4939, 39.9247, "south"),
            new AirportDto("SVX", "Кольцово", "Екатеринбург", 56.7431, 60.8027, "ural"),
            new AirportDto("UFA", "Уфа", "Уфа", 54.5575, 55.8744, "ural"),
            new AirportDto("OVB", "Толмачево", "Новосибирск", 55.0126, 82.6507, "siberia"),
            new AirportDto("KJA", "Емельяново", "Красноярск", 56.1729, 92.4933, "siberia"),
            new AirportDto("IKT", "Иркутск", "Иркутск", 52.268, 104.3886, "siberia"),
            new AirportDto("VVO", "Кневичи", "Владивосток", 43.3989, 132.148, "far_east"),
            new AirportDto("KHV", "Новый", "Хабаровск", 48.5272, 135.188, "far_east"),
            new AirportDto("UUS", "Хомутово", "Южно-Сахалинск", 46.8887, 142.717, "far_east")
    );

    private final Map<String, AirportDto> byId = AIRPORTS.stream()
            .collect(Collectors.toUnmodifiableMap(AirportDto::id, Function.identity()));

    public List<AirportDto> getAll() {
        return AIRPORTS;
    }

    public Optional<AirportDto> getById(String airportId) {
        return Optional.ofNullable(byId.get(airportId));
    }
}
